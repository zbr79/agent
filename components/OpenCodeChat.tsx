"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";
import type { ChatImage, ChatMessage } from "@/lib/types";
import { ModelMarkerParser } from "@/lib/markers";
import { formatLimitReset, parseLimitPayload, type LimitWindow } from "@/lib/format";
import { AlertTriangle } from "lucide-react";
import { STR, useUiLang } from "@/lib/i18n";
import { useInsulinMode } from "@/lib/prefs";

interface UiMessage {
  id: number;
  role: "user" | "model";
  text: string;
  images?: ChatImage[];
  streaming?: boolean;
  failed?: boolean;
  model?: string;
  trying?: string;
  elapsed?: number;
}

let nextId = 1;

function toApiMessages(messages: UiMessage[]): ChatMessage[] {
  return messages
    .filter(
      (message) =>
        !message.failed && (message.text || (message.images?.length ?? 0) > 0)
    )
    .map(({ role, text, images }) => ({ role, text, images }));
}

export default function OpenCodeChat() {
  const lang = useUiLang();
  const t = STR[lang];
  const [insulinMode, toggleInsulinMode] = useInsulinMode();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [limitReset, setLimitReset] = useState<number | null>(null);
  const [limitWindow, setLimitWindow] = useState<LimitWindow | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string, images?: ChatImage[]) => {
      const trimmed = text.trim();
      if ((!trimmed && (images?.length ?? 0) === 0) || sending) return;

      const userMessage: UiMessage = {
        id: nextId++,
        role: "user",
        text: trimmed,
        images,
      };
      const modelMessage: UiMessage = {
        id: nextId++,
        role: "model",
        text: "",
        streaming: true,
        elapsed: 0,
      };
      const history = toApiMessages([...messages, userMessage]);
      setMessages((prev) => [...prev, userMessage, modelMessage]);
      setSending(true);

      let elapsedValue = 0;
      const elapsedTimer = setInterval(() => {
        elapsedValue += 1;
        setMessages((prev) =>
          prev.map((message) =>
            message.id === modelMessage.id
              ? { ...message, elapsed: (message.elapsed ?? 0) + 1 }
              : message
          )
        );
      }, 1000);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/opencode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: lang,
            mode: insulinMode ? "preset" : "free",
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const body = await response.text();
          let error = "Chat request failed.";
          try {
            error = JSON.parse(body).error ?? error;
          } catch {}
          throw new Error(error);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new ModelMarkerParser();
        let modelText = "";
        let modelName: string | undefined;
        let limitHit = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const { text, model, limit } = parser.push(
            decoder.decode(value, { stream: true })
          );
          if (limit !== undefined) {
            limitHit = true;
            const parsed = parseLimitPayload(limit);
            if (parsed) {
              setLimitWindow(parsed.window);
              setLimitReset(parsed.resetAt);
            }
          }
          if (model) {
            modelName = model;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === modelMessage.id
                  ? { ...message, model: modelName, trying: undefined }
                  : message
              )
            );
          }
          if (text && !limitHit) {
            modelText += text;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === modelMessage.id
                  ? { ...message, text: message.text + text }
                  : message
              )
            );
          }
        }
        if (limitHit) {
          setMessages((prev) =>
            prev.filter((message) => message.id !== modelMessage.id)
          );
          return;
        }
        const tail = parser.flush();
        if (tail) {
          modelText += tail;
          setMessages((prev) =>
            prev.map((message) =>
              message.id === modelMessage.id
                ? { ...message, text: message.text + tail }
                : message
            )
          );
        }
        setMessages((prev) =>
          prev.map((message) =>
            message.id === modelMessage.id
              ? { ...message, streaming: false, elapsed: elapsedValue }
              : message
          )
        );
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        setMessages((prev) =>
          prev.map((message) =>
            message.id === modelMessage.id
              ? {
                  ...message,
                  streaming: false,
                  failed: !aborted,
                  text: aborted
                    ? message.text
                    : message.text ||
                      (error instanceof Error ? error.message : "Chat request failed."),
                }
              : message
          )
        );
      } finally {
        clearInterval(elapsedTimer);
        setSending(false);
        abortRef.current = null;
      }
    },
    [messages, sending, lang, insulinMode]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (limitReset === null) return;
    const timer = setInterval(() => {
      if (Date.now() >= limitReset) setLimitReset(null);
    }, 10_000);
    return () => clearInterval(timer);
  }, [limitReset]);

  const limitTimeLabel =
    limitReset !== null ? formatLimitReset(limitReset, lang) : "";
  const limitWindowLabel = limitWindow ? t[`limit.window.${limitWindow}`] : "";

  return (
    <div className="app">
      {messages.length === 0 ? (
        <main className="welcome">
          <h2>OpenCode</h2>
          {limitReset !== null && (
            <p className="limit-banner">
              <AlertTriangle size={14} />
              {limitWindowLabel} {t["limit.exhausted"]} ·{" "}
              {t["limit.banner"].replace("{time}", limitTimeLabel)}
            </p>
          )}
          <div className="composer-toggles">
            <button
              type="button"
              className={`composer-toggle${insulinMode ? " active" : ""}`}
              onClick={() => toggleInsulinMode(!insulinMode)}
              aria-pressed={insulinMode}
            >
              {t["settings.insulinMode"]}
            </button>
          </div>
          <Composer
            sending={sending}
            onSend={send}
            onStop={stop}
            disabled={limitReset !== null}
          />
        </main>
      ) : (
        <>
          <MessageBubble messages={messages} guest={false} summary={null} />
          {limitReset !== null && (
            <p className="limit-banner">
              <AlertTriangle size={14} />
              {limitWindowLabel} {t["limit.exhausted"]} ·{" "}
              {t["limit.banner"].replace("{time}", limitTimeLabel)}
            </p>
          )}
          <Composer
            sending={sending}
            onSend={send}
            onStop={stop}
            disabled={limitReset !== null}
          />
        </>
      )}
    </div>
  );
}
