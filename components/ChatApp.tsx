"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";
import ConcludeButton from "./ConcludeButton";
import ConcludeModal from "./ConcludeModal";
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
  _id?: string;
  _index?: string;
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

function persistMessage(
  sessionId: string,
  message: {
    role: "user" | "model";
    text: string;
    images?: ChatImage[];
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

function titleFrom(text: string, fallback: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean || fallback;
}

export default function ChatApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");
  const lang = useUiLang();
  const t = STR[lang];
  const [insulinMode, toggleInsulinMode] = useInsulinMode();

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<{
    result: ConcludeResult;
    sourceText: string;
  } | null>(null);
  const [concludeDraft, setConcludeDraft] = useState<{
    result: ConcludeResult;
    sourceText: string;
  } | null>(null);
  const [concludeResult, setConcludeResult] = useState<{
    result: ConcludeResult;
    sourceText: string;
  } | null>(null);
  const [concludeSaved, setConcludeSaved] = useState(false);
  // The single record this chat owns — later concludes UPDATE it instead of
  // creating duplicates (one conclusion per chat).
  const recordIdRef = useRef<string | null>(null);

  // Merge a new reply's conclusion into the accumulated one: meals append
  // (dedup by name+time, dishes by name — existing dishes keep the user's
  // edits), and the glucose/time items take the latest reading.
  const mergeConclusion = useCallback(
    (next: ConcludeResult): ConcludeResult => {
      const base = concludeResult?.result;
      if (!base) return next;
      const meals = [...(base.meals ?? [])];
      for (const meal of next.meals ?? []) {
        const existing = meals.find(
          (m) => m.name === meal.name && m.time === meal.time
        );
        if (existing) {
          const dishNames = new Set((existing.dishes ?? []).map((d) => d.name));
          const fresh = (meal.dishes ?? []).filter((d) => !dishNames.has(d.name));
          if (fresh.length) {
            existing.dishes = [...(existing.dishes ?? []), ...fresh];
          }
        } else {
          meals.push({ ...meal, dishes: meal.dishes ? [...meal.dishes] : undefined });
        }
      }
      const items = [...(base.items ?? [])];
      for (const item of next.items ?? []) {
        // Accumulate: keep every distinct reading (the tail now covers the
        // whole conversation); exact name+value duplicates are skipped.
        if (
          !items.some(
            (existing) => existing.name === item.name && existing.value === item.value
          )
        ) {
          items.push({ ...item });
        }
      }
      return {
        title: next.title || base.title,
        summary: next.summary || base.summary,
        items,
        meals,
      };
    },
    [concludeResult]
  );
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  // const [shareMsg, setShareMsg] = useState<"link" | "error" | null>(null); // share feature removed
  const [flashId, setFlashId] = useState<number | null>(null);
  const handledMsgRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [freeNotice, setFreeNotice] = useState(false);

  // Free-model notice: centered gray text, auto-dismisses after a few seconds.
  useEffect(() => {
    if (!freeNotice) return;
    const timer = setTimeout(() => setFreeNotice(false), 6000);
    return () => clearTimeout(timer);
  }, [freeNotice]);

  // Auth state refresh: runs on mount, on URL changes, and when the sidebar
// signals login/logout ("inschat-auth") — ChatApp never remounts for those,
// so the initial check alone leaves isAuthed stale and messages silently go
// to the guest store.
useEffect(() => {
  let alive = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  const check = () =>
    fetch("/api/auth/me", { signal: controller.signal })
      .then((response) => {
        if (alive) setIsAuthed(response.status === 200);
      })
      .catch(() => {
        if (alive) setIsAuthed(false);
      });
  check().finally(() => clearTimeout(timer));
  const onAuth = () => {
    const ctrl = new AbortController();
    fetch("/api/auth/me", { signal: ctrl.signal })
      .then((response) => {
        if (alive) setIsAuthed(response.status === 200);
      })
      .catch(() => {
        if (alive) setIsAuthed(false);
      });
  };
  window.addEventListener("inschat-auth", onAuth);
  return () => {
    alive = false;
    controller.abort();
    clearTimeout(timer);
    window.removeEventListener("inschat-auth", onAuth);
  };
}, [searchParams]);

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
    setConcludeResult(null);
    setConcludeSaved(false);
    recordIdRef.current = null;
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
              images?: ChatImage[];
              model?: string;
              elapsed?: number;
            }[];
            conclusion?: SessionConclusion | null;
            recordId?: string | null;
          }) => {
            if (sessionIdRef.current !== id) return;
            setMessages(
              body.messages.map((message) => ({
                id: nextId++,
                role: message.role === "model" ? "model" : "user",
                text: message.text,
                images: message.images,
                model: message.model,
                elapsed: message.elapsed,
                _id: (message as { _id?: string })._id,
              }))
            );
            setSummary(null);
            // Restore the saved conclusion (and its record link when known)
            // so the button opens the stored report instead of re-running
            // conclude. Older sessions may lack recordId — still restore.
            if (body.conclusion) {
              recordIdRef.current = body.recordId ?? null;
              setConcludeSaved(true);
              setConcludeResult({
                result: {
                  title: body.conclusion.title,
                  summary: body.conclusion.summary,
                  items: body.conclusion.items,
                  meals: body.conclusion.meals,
                },
                sourceText: body.conclusion.sourceText ?? "",
              });
            }
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
          local.messages.map(async (message, index) => ({
            id: nextId++,
            role: (message.role === "model" ? "model" : "user") as "user" | "model",
            text: message.text,
            images: message.images?.length
              ? message.images
              : message.imageKeys?.length
                ? (
                    await Promise.all(
                      message.imageKeys.map(async (key) => (await getGuestImage(key)) ?? null)
                    )
                  ).filter((image): image is ChatImage => image !== null)
                : undefined,
            model: message.model,
            elapsed: message.elapsed,
            _index: String(index),
          }))
        ).then((hydrated) => {
          if (sessionIdRef.current === id) setMessages(hydrated);
        });
        setSummary(null);
        if (local.conclusion) {
          recordIdRef.current = local.recordId ?? null;
          setConcludeSaved(true);
          setConcludeResult({
            result: {
              title: local.conclusion.title,
              summary: local.conclusion.summary,
              items: local.conclusion.items,
              meals: local.conclusion.meals,
            },
            sourceText: local.conclusion.sourceText ?? "",
          });
        }
      } else {
        sessionIdRef.current = null;
        router.replace("/");
      }
      setLoading(false);
    }
  }, [sessionParam, isAuthed, router]);

  // Usage-limit banner removed (2026-09-02): exhaustion now falls back to
// free models for text, and image sends get the reply-text explanation.

  // Search jump: flash + scroll to the matched message, then clear ?msg.
  useEffect(() => {
    const target = searchParams.get("msg");
    if (!target || handledMsgRef.current === target || messages.length === 0) return;
    const match = messages.find(
      (message) => message._id === target || message._index === target
    );
    if (!match) return;
    handledMsgRef.current = target;
    setFlashId(match.id);
    setTimeout(() => {
      document
        .getElementById(`msg-${match.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    setTimeout(() => setFlashId(null), 2600);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("msg");
    router.replace(`/?${params.toString()}`);
  }, [searchParams, messages, router]);

  // Streams a model reply for the given message list (which already ends
  // with the user message that triggers it).
  const streamReply = useCallback(
    async (base: UiMessage[]) => {
      const modelMessage: UiMessage = {
        id: nextId++,
        role: "model",
        text: "",
        streaming: true,
        elapsed: 0,
      };
      setMessages([...base, modelMessage]);
      setSending(true);
      setFreeNotice(false);

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
      const history = toApiMessages(base);
      let aborted = false;
      let parsedConclude: ConcludeResult | null = null;

      try {
        const response = await fetch("/api/chat", {
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
          await response.text();
          throw new Error(t["chat.requestFailed"]);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new ModelMarkerParser();
        let modelText = "";
        let modelName: string | undefined;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const { text, model, trying, free } = parser.push(
            decoder.decode(value, { stream: true })
          );
          if (free) {
            setFreeNotice(true);
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
            // Health-mode replies end with a <CONCLUDE> JSON tail for the
            // single-call recording flow — hide it from the bubble.
            const openIdx = modelText.indexOf("<CONCLUDE>");
            const visible = openIdx === -1 ? modelText : modelText.slice(0, openIdx);
            setMessages((prev) =>
              prev.map((message) =>
                message.id === modelMessage.id
                  ? { ...message, text: visible }
                  : message
              )
            );
          }
        }
        const tail = parser.flush();
        if (tail) {
          modelText += tail;
          const openIdx = modelText.indexOf("<CONCLUDE>");
          const visible = openIdx === -1 ? modelText : modelText.slice(0, openIdx);
          setMessages((prev) =>
            prev.map((message) =>
              message.id === modelMessage.id
                ? { ...message, text: visible }
                : message
            )
          );
        }
        setMessages((prev) =>
          prev.map((message) =>
            message.id === modelMessage.id ? { ...message, streaming: false } : message
          )
        );

        // Single-call recording: in health mode the reply itself carries the
        // <CONCLUDE> JSON tail — parse it instead of calling /api/conclude.
        let savedText = modelText;
        if (insulinMode) {
          const match = modelText.match(/<CONCLUDE>([\s\S]*?)<\/CONCLUDE>/);
          if (match) {
            const visibleText = modelText.slice(0, match.index).trimEnd();
            savedText = visibleText;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === modelMessage.id
                  ? { ...message, text: visibleText }
                  : message
              )
            );
            try {
              const raw = JSON.parse(match[1]) as Record<string, unknown>;
              if (raw && typeof raw === "object") {
                parsedConclude = {
                  title:
                    typeof raw.title === "string" ? raw.title : t["summary.report"],
                  summary:
                    typeof raw.summary === "string" ? raw.summary : "",
                  items: Array.isArray(raw.items) ? (raw.items as ConcludeResult["items"]) : [],
                  meals: Array.isArray(raw.meals)
                    ? (raw.meals as ConcludeResult["meals"])
                    : undefined,
                };
              }
            } catch {
              parsedConclude = null;
            }
          }
          if (parsedConclude) {
            const merged = mergeConclusion(parsedConclude);
            setConcludeSaved(false);
            setConcludeResult({ result: merged, sourceText: savedText });
            // Store the conclusion into the chat right away so the button
            // stays available after a refresh — even before the user saves
            // the record. The record link is added when they save.
            const sessionId = sessionIdRef.current;
            if (sessionId) {
              const payload = {
                title: merged.title,
                summary: merged.summary,
                items: merged.items,
                meals: merged.meals,
                sourceText: savedText,
              };
              if (isAuthed) {
                fetch(`/api/sessions/${sessionId}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ conclusion: payload }),
                }).catch(() => {});
              } else {
                setGuestConclusion(sessionId, payload);
              }
            }
          }
        }
        const sessionId = sessionIdRef.current;
        if (sessionId) {
          if (isAuthed) {
            persistMessage(sessionId, {
              role: "model",
              text: savedText,
              model: modelName,
              elapsed: elapsedValue,
            });
          } else {
            appendGuestMessage(sessionId, {
              role: "model",
              text: savedText,
              model: modelName,
              elapsed: elapsedValue,
            });
          }
        }
      } catch (error) {
        aborted = error instanceof DOMException && error.name === "AbortError";
        setMessages((prev) =>
          prev.map((message) =>
            message.id === modelMessage.id
              ? {
                  ...message,
                  streaming: false,
                  failed: !aborted,
                  text: aborted
                    ? message.text
                     : message.text || (error instanceof Error ? error.message : t["chat.requestFailed"]),
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
    [isAuthed, lang, insulinMode]
  );

  const send = useCallback(
    async (text: string, images?: ChatImage[]) => {
      const trimmed = text.trim();
      if ((!trimmed && (images?.length ?? 0) === 0) || sending || isAuthed === null) return;
      const authed = isAuthed;

      let sessionId = sessionIdRef.current;
      if (!sessionId) {
        if (authed) {
          try {
            const response = await fetch("/api/sessions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: titleFrom(trimmed, t["nav.newChat"]) }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(t["common.requestFailed"]);
            sessionId = body.session._id;
          } catch {
            sessionId = null;
          }
        } else {
          sessionId = createGuestSession(titleFrom(trimmed, t["nav.newChat"])).id;
        }
        if (sessionId) {
          sessionIdRef.current = sessionId;
          router.replace(`/?session=${sessionId}`);
        }
      }

      const userMessage: UiMessage = { id: nextId++, role: "user", text: trimmed, images };
      if (sessionId) {
        if (authed) {
          persistMessage(sessionId, { role: "user", text: trimmed, images });
        } else if (images && images.length > 0) {
          const keys = images.map((_, i) => `${sessionId}:${userMessage.id}:${i}`);
          const stored = await Promise.all(
            keys.map((key) => putGuestImage(key, images[Number(key.split(":").pop() ?? 0)]))
          );
          const keptImages = images.filter((_, i) => stored[i]);
          appendGuestMessage(sessionId, {
            role: "user",
            text: trimmed,
            images: keptImages.length ? keptImages : images,
            imageKeys: stored.every(Boolean) ? keys : undefined,
          });
        } else {
          appendGuestMessage(sessionId, { role: "user", text: trimmed });
        }
      }
      await streamReply([...messages, userMessage]);
    },
    [messages, sending, isAuthed, router, streamReply]
  );

  // Truncate persisted state up to the given message list (revert-style).
  const truncatePersisted = useCallback(
    async (base: UiMessage[]) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      const keep = base.filter(
        (message) => message.role === "user" || !message.failed
      ).length;
      if (isAuthed) {
        await fetch(`/api/sessions/${sessionId}/messages`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keep }),
        }).catch(() => {});
      } else {
        truncateGuestSession(sessionId, keep);
      }
    },
    [isAuthed]
  );

  const startEdit = useCallback(
    (id: number) => {
      const message = messages.find((m) => m.id === id);
      if (!message || message.role !== "user") return;
      setEditingId(id);
      setEditingText(message.text);
    },
    [messages]
  );

  const editSave = useCallback(
    async (id: number) => {
      const index = messages.findIndex((m) => m.id === id);
      if (index < 0 || !editingText.trim()) return;
      const edited: UiMessage = { ...messages[index], text: editingText.trim() };
      const base = messages.slice(0, index);
      setEditingId(null);
      setSummary(null);
      await truncatePersisted(base);
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        if (isAuthed) {
          persistMessage(sessionId, { role: "user", text: edited.text, images: edited.images });
        } else {
          appendGuestMessage(sessionId, {
            role: "user",
            text: edited.text,
            images: edited.images,
          });
        }
      }
      await streamReply([...base, edited]);
    },
    [messages, editingText, isAuthed, truncatePersisted, streamReply]
  );

  const regenerate = useCallback(
    async (id: number) => {
      const index = messages.findIndex((m) => m.id === id);
      if (index < 1) return;
      const previous = messages[index - 1];
      if (previous.role !== "user") return;
      const base = messages.slice(0, index);
      setSummary(null);
      await truncatePersisted(base);
      await streamReply(base);
    },
    [messages, truncatePersisted, streamReply]
  );

/* Share feature removed (2026-08-30).
  const createShare = useCallback(
    async (kind: "chat" | "message", title: string, list: UiMessage[]) => {
      const payload = list
        .filter((m) => (m.role === "user" || !m.failed) && (m.text || m.image))
        .map((m) => ({
          role: m.role,
          text: m.text,
          image: m.image,
          model: m.model,
          elapsed: m.elapsed,
        }));
      try {
        const response = await fetch("/api/shares", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, title, messages: payload }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "Share failed.");
        await navigator.clipboard.writeText(`${location.origin}/share/${body.token}`);
        setShareMsg("link");
      } catch {
        setShareMsg("error");
      }
      setTimeout(() => setShareMsg(null), 2500);
    },
    []
  );

  const shareMessage = useCallback(
    (id: number) => {
      const message = messages.find((m) => m.id === id);
      if (!message) return;
      void createShare("message", titleFrom(message.text || "Message"), [message]);
    },
    [messages, createShare]
  );

  const shareChat = useCallback(() => {
    const list = messages.filter(
      (m) => (m.role === "user" || !m.failed) && (m.text || m.image)
    );
    if (!list.length) return;
    const firstUser = list.find((m) => m.role === "user");
    void createShare("chat", titleFrom(firstUser?.text ?? "Chat"), list.slice(-20));
  }, [messages, createShare]);
*/

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

/* Revert feature commented out (2026-08-30) — edit/regenerate replaced it.
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
      } else {
        truncateGuestSession(sessionId, keep);
      }
    },
    [messages, sending, isAuthed]
  );
*/

  const concludeReady = concludeResult !== null;

  return (
    <div className="app">
      {loading ? (
        <main className="messages">
          <p className="empty">{t["records.loading"]}</p>
        </main>
      ) : messages.length === 0 ? (
        <main className="welcome">
          <h2>{t["welcome.title"]}</h2>
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
            onSend={send}
            onStop={stop}
            sending={sending}
            placeholder={t["composer.placeholder"]}
          />
        </main>
      ) : (
        <MessageBubble
          messages={messages}
          guest={isAuthed === false}
          summary={summary}
          summarySaved={concludeSaved}
          flashId={flashId}
          onEdit={startEdit}
          onRegenerate={regenerate}
          canAct={!sending}
          editingId={editingId}
          editingText={editingText}
          onEditingText={setEditingText}
          onEditSave={editSave}
          onEditCancel={() => setEditingId(null)}
        />
      )}
      {messages.length > 0 && (
        <div className="composer-toggles bottom">
          <button
            type="button"
            className={`composer-toggle${insulinMode ? " active" : ""}`}
            onClick={() => toggleInsulinMode(!insulinMode)}
            aria-pressed={insulinMode}
          >
            {t["settings.insulinMode"]}
          </button>
          {summaryError && <p className="conclusion-error">{summaryError}</p>}
          <ConcludeButton
            onClick={() => {
              if (concludeReady) setConcludeDraft(concludeResult);
            }}
            ready={concludeReady}
            disabled={!concludeReady || sending}
          />
        </div>
      )}
      {messages.length > 0 && (
        <Composer
          onSend={send}
          onStop={stop}
          sending={sending}
          placeholder={t["composer.placeholder"]}
        />
      )}
      {freeNotice && (
        <p className="free-note-overlay" onClick={() => setFreeNotice(false)}>
          {t["free.notice"]}
        </p>
      )}
      <ConcludeModal
        open={concludeDraft !== null}
        result={concludeDraft?.result ?? null}
        sourceText={concludeDraft?.sourceText ?? ""}
        guest={isAuthed === false}
        recordId={recordIdRef.current}
        onClose={() => {
          setConcludeDraft(null);
        }}
        onSaved={(edited, savedRecordId) => {
          recordIdRef.current = savedRecordId;
          setSummary({ result: edited, sourceText: concludeDraft?.sourceText ?? "" });
          setConcludeSaved(true);
          // Keep the accumulated conclusion = the edited one, so later
          // replies merge ON TOP of the user's changes.
          setConcludeResult({ result: edited, sourceText: concludeDraft?.sourceText ?? "" });
          setConcludeDraft(null);
          // Link the saved record to this session so a refresh restores the
          // conclusion (button glows → opens the stored report, no re-call).
          const sessionId = sessionIdRef.current;
          if (!sessionId) return;
          const payload = {
            title: edited.title,
            summary: edited.summary,
            items: edited.items,
            meals: edited.meals,
            sourceText: concludeDraft?.sourceText ?? "",
          };
          if (isAuthed) {
            fetch(`/api/sessions/${sessionId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conclusion: payload }),
            }).catch(() => {});
            if (savedRecordId) {
              fetch(`/api/sessions/${sessionId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ recordId: savedRecordId }),
              }).catch(() => {});
            }
          } else {
            setGuestConclusion(sessionId, payload, savedRecordId);
          }
        }}
      />
    </div>
  );
}
