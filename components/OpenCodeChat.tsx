"use client";

import { useCallback, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import type { ChatMessage } from "@/lib/types";
import { ModelMarkerParser } from "@/lib/markers";
import { STR, useUiLang, setUiLang } from "@/lib/i18n";

interface UiMessage {
  id: number;
  role: "user" | "model";
  text: string;
  streaming?: boolean;
  failed?: boolean;
  model?: string;
  trying?: string;
  elapsed?: number;
}

let nextId = 1;

function toApiMessages(messages: UiMessage[]): ChatMessage[] {
  return messages
    .filter((message) => !message.failed && message.text)
    .map(({ role, text }) => ({ role, text }));
}

function TextComposer({
  sending,
  onSend,
  onStop,
}: {
  sending: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !sending;

  const handleSend = () => {
    if (!canSend) return;
    onSend(text);
    setText("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="composer">
      <div className="input-row">
        <textarea
          rows={1}
          value={text}
          placeholder=""
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Message"
        />
        {sending ? (
          <button
            type="button"
            className="send-button"
            onClick={onStop}
            aria-label="Stop"
          >
            ■
          </button>
        ) : (
          <button
            type="button"
            className="send-button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}

export default function OpenCodeChat() {
  const lang = useUiLang();
  const t = STR[lang];
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const userMessage: UiMessage = { id: nextId++, role: "user", text: trimmed };
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
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const { text, model } = parser.push(
            decoder.decode(value, { stream: true })
          );
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
          if (text) {
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
    [messages, sending, lang]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>OpenCode</h1>
        <button
          type="button"
          className="lang-toggle"
          onClick={() => setUiLang(lang === "zh" ? "en" : "zh")}
          aria-label="Switch language"
        >
          {t["lang.button"]}
        </button>
      </header>
      {messages.length === 0 ? (
        <main className="messages">
          <p className="empty">{t["opencode.empty"]}</p>
        </main>
      ) : (
        <MessageBubble messages={messages} guest={false} summary={null} />
      )}
      <TextComposer sending={sending} onSend={send} onStop={stop} />
    </div>
  );
}
