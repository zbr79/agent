"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";
import ConcludeButton from "./ConcludeButton";
import type {
  ChatImage,
  ChatMessage,
  ConcludeResult,
  SessionConclusion,
} from "@/lib/types";
import { ModelMarkerParser } from "@/lib/markers";
import {
  appendGuestMessage,
  createGuestSession,
  getGuestSession,
  setGuestConclusion,
  truncateGuestSession,
} from "@/lib/guestStore";
import { putGuestImage, getGuestImage } from "@/lib/guestImages";
import { STR, useUiLang } from "@/lib/i18n";

interface UiMessage {
  id: number;
  role: "user" | "model";
  text: string;
  image?: ChatImage;
  streaming?: boolean;
  failed?: boolean;
  model?: string;
  trying?: string;
  elapsed?: number;
}

let nextId = 1;

function toApiMessages(messages: UiMessage[]): ChatMessage[] {
  return messages
    .filter((message) => !message.failed && (message.text || message.image))
    .map(({ role, text, image }) => ({ role, text, image }));
}

function persistMessage(
  sessionId: string,
  message: {
    role: "user" | "model";
    text: string;
    image?: ChatImage;
    model?: string;
    elapsed?: number;
  }
) {
  fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  }).catch(() => {});
}

function titleFrom(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean || "New chat";
}

export default function ChatApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");
  const lang = useUiLang();
  const t = STR[lang];

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const [concluding, setConcluding] = useState(false);
  const [summary, setSummary] = useState<{
    result: ConcludeResult;
    sourceText: string;
  } | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch("/api/auth/me", { signal: controller.signal })
      .then((response) => {
        if (alive) setIsAuthed(response.status === 200);
      })
      .catch(() => {
        if (alive) setIsAuthed(false);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (isAuthed === null) return;
    const id = sessionParam;
    if (id && sessionIdRef.current === id) {
      // Same session we're already viewing (router.replace from send()) —
      // keep live state, don't reset/refetch.
      setLoading(false);
      return;
    }
    setMessages([]);
    setSummary(null);
    if (!id) {
      sessionIdRef.current = null;
      setLoading(false);
      return;
    }
    if (isAuthed) {
      sessionIdRef.current = id;
      setLoading(true);
      fetch(`/api/sessions/${id}`)
        .then((response) => {
          if (!response.ok) throw new Error("not found");
          return response.json();
        })
        .then(
          (body: {
            messages: {
              role: string;
              text: string;
              image?: ChatImage;
              model?: string;
              elapsed?: number;
            }[];
            conclusion?: SessionConclusion | null;
          }) => {
            if (sessionIdRef.current !== id) return;
            setMessages(
              body.messages.map((message) => ({
                id: nextId++,
                role: message.role === "model" ? "model" : "user",
                text: message.text,
                image: message.image,
                model: message.model,
                elapsed: message.elapsed,
              }))
            );
            setSummary(
              body.conclusion
                ? {
                    result: {
                      title: body.conclusion.title,
                      summary: body.conclusion.summary,
                      items: body.conclusion.items,
                      meals: body.conclusion.meals,
                    },
                    sourceText: body.conclusion.sourceText ?? "",
                  }
                : null
            );
          }
        )
        .catch(() => {
          sessionIdRef.current = null;
          router.replace("/");
        })
        .finally(() => {
          if (sessionIdRef.current === id) setLoading(false);
        });
    } else {
      const local = getGuestSession(id);
      if (local) {
        sessionIdRef.current = id;
        Promise.all(
          local.messages.map(async (message) => ({
            id: nextId++,
            role: (message.role === "model" ? "model" : "user") as "user" | "model",
            text: message.text,
            image:
              message.image ??
              (message.imageKey ? await getGuestImage(message.imageKey) : undefined),
            model: message.model,
            elapsed: message.elapsed,
          }))
        ).then((hydrated) => {
          if (sessionIdRef.current === id) setMessages(hydrated);
        });
        setSummary(
          local.conclusion
            ? {
                result: {
                  title: local.conclusion.title,
                  summary: local.conclusion.summary,
                  items: local.conclusion.items,
                  meals: local.conclusion.meals,
                },
                sourceText: local.conclusion.sourceText ?? "",
              }
            : null
        );
      } else {
        sessionIdRef.current = null;
        router.replace("/");
      }
      setLoading(false);
    }
  }, [sessionParam, isAuthed, router]);

  const send = useCallback(
    async (text: string, image?: ChatImage) => {
      if (sending || isAuthed === null) return;
      const authed = isAuthed;

      let sessionId = sessionIdRef.current;
      if (!sessionId) {
        if (authed) {
          try {
            const response = await fetch("/api/sessions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: titleFrom(text) }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body?.error ?? "Could not create session.");
            sessionId = body.session._id;
          } catch {
            sessionId = null;
          }
        } else {
          sessionId = createGuestSession(titleFrom(text)).id;
        }
        if (sessionId) {
          sessionIdRef.current = sessionId;
          router.replace(`/?session=${sessionId}`);
        }
      }

      const userMessage: UiMessage = { id: nextId++, role: "user", text, image };
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
      let elapsedTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
        elapsedValue += 1;
        setMessages((prev) =>
          prev.map((message) =>
            message.id === modelMessage.id
              ? { ...message, elapsed: (message.elapsed ?? 0) + 1 }
              : message
          )
        );
      }, 1000);

      if (sessionId) {
        if (authed) {
          persistMessage(sessionId, { role: "user", text, image });
        } else if (image) {
          const key = `${sessionId}:${userMessage.id}`;
          const stored = await putGuestImage(key, image);
          appendGuestMessage(sessionId, {
            role: "user",
            text,
            image: stored ? undefined : image,
            imageKey: stored ? key : undefined,
          });
        } else {
          appendGuestMessage(sessionId, { role: "user", text });
        }
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
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
          const { text, model, trying } = parser.push(
            decoder.decode(value, { stream: true })
          );
          if (model) modelName = model;
          if (model) {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === modelMessage.id
                  ? { ...message, model: modelName, trying: undefined }
                  : message
              )
            );
          } else if (trying) {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === modelMessage.id
                  ? { ...message, trying }
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
            message.id === modelMessage.id ? { ...message, streaming: false } : message
          )
        );
        if (sessionId) {
          if (authed) {
            persistMessage(sessionId, {
              role: "model",
              text: modelText,
              model: modelName,
              elapsed: elapsedValue,
            });
          } else {
            appendGuestMessage(sessionId, {
              role: "model",
              text: modelText,
              model: modelName,
              elapsed: elapsedValue,
            });
          }
        }
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
                    : message.text || (error instanceof Error ? error.message : "Chat request failed."),
                }
              : message
          )
        );
      } finally {
        if (elapsedTimer) clearInterval(elapsedTimer);
        setSending(false);
        abortRef.current = null;
      }
    },
    [messages, sending, isAuthed, router, lang]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const persistConclusion = useCallback(
    (conclusion: SessionConclusion | null) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      if (isAuthed) {
        fetch(`/api/sessions/${sessionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conclusion }),
        }).catch(() => {});
      } else {
        setGuestConclusion(sessionId, conclusion);
      }
    },
    [isAuthed]
  );

  // Revert: drop everything after the chosen message (locally + persisted).
  const revertTo = useCallback(
    async (id: number) => {
      if (sending) return;
      const index = messages.findIndex((message) => message.id === id);
      if (index < 0 || index >= messages.length - 1) return;
      const kept = messages.slice(0, index + 1);
      // Only successfully persisted messages count toward the server's list:
      // user messages always persist; model messages persist only when ok.
      const keep = kept.filter(
        (message) => message.role === "user" || !message.failed
      ).length;
      setMessages(kept);
      setSummary(null);
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      if (isAuthed) {
        fetch(`/api/sessions/${sessionId}/messages`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keep }),
        }).catch(() => {});
        persistConclusion(null);
      } else {
        truncateGuestSession(sessionId, keep);
      }
    },
    [messages, sending, isAuthed, persistConclusion]
  );

  const concludeAll = useCallback(async () => {
    if (concluding || sending) return;
    const sourceText = messages
      .filter((message) => message.role === "model" && !message.failed && message.text)
      .map((message) => message.text)
      .join("\n\n")
      .slice(0, 16000);
    if (!sourceText.trim()) return;
    setConcluding(true);
    setSummaryError(null);
    setSummary(null);
    try {
      const response = await fetch("/api/conclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sourceText }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? "Conclude failed.");
      }
      const result = body as ConcludeResult;
      setSummary({ result, sourceText });
      persistConclusion({
        title: result.title,
        summary: result.summary,
        items: result.items,
        meals: result.meals,
        sourceText,
      });
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Conclude failed.");
      } finally {
      setConcluding(false);
    }
  }, [concluding, sending, messages, persistConclusion]);

  return (
    <div className="app">
      {loading ? (
        <main className="messages">
          <p className="empty">{t["records.loading"]}</p>
        </main>
      ) : (
        <MessageBubble
          messages={messages}
          guest={isAuthed === false}
          summary={summary}
          onRevert={revertTo}
          canRevert={!sending}
        />
      )}
      <div className="conclude-bar">
        {summaryError && <p className="conclusion-error">{summaryError}</p>}
        <ConcludeButton
          onClick={concludeAll}
          loading={concluding}
          disabled={
            sending ||
            !messages.some(
              (message) => message.role === "model" && !message.failed && message.text
            )
          }
        />
      </div>
      <Composer onSend={send} onStop={stop} sending={sending} />
    </div>
  );
}
