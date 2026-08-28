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
} from "@/lib/guestStore";

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
  message: { role: "user" | "model"; text: string; image?: ChatImage }
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
            messages: { role: string; text: string; image?: ChatImage }[];
            conclusion?: SessionConclusion | null;
          }) => {
            if (sessionIdRef.current !== id) return;
            setMessages(
              body.messages.map((message) => ({
                id: nextId++,
                role: message.role === "model" ? "model" : "user",
                text: message.text,
                image: message.image,
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
        setMessages(
          local.messages.map((message) => ({
            id: nextId++,
            role: message.role === "model" ? "model" : "user",
            text: message.text,
            image: message.image,
          }))
        );
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

      let elapsedTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
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
        } else {
          appendGuestMessage(sessionId, { role: "user", text, image });
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
            persistMessage(sessionId, { role: "model", text: modelText });
          } else {
            appendGuestMessage(sessionId, { role: "model", text: modelText });
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
    [messages, sending, isAuthed, router]
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
      <header className="header">
        <h1>InsChat</h1>
      </header>
      {loading ? (
        <main className="messages">
          <p className="empty">Loading conversation…</p>
        </main>
      ) : (
        <MessageBubble
          messages={messages}
          guest={isAuthed === false}
          summary={summary}
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
