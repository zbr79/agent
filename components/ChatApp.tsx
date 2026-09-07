"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";
import ActivityPanel, {
  finalizeRunningActivities,
  hasSuccessfulProgress,
  hasToolErrors,
  upsertActivity,
  type ActivityItem,
} from "./ActivityPanel";
import type { ChatImage, ChatMessage } from "@/lib/types";
import { ModelMarkerParser } from "@/lib/markers";
import {
  appendGuestMessage,
  createGuestSession,
  getGuestSession,
  truncateGuestSession,
} from "@/lib/guestStore";
import { putGuestImage, getGuestImage } from "@/lib/guestImages";
import { STR, useUiLang } from "@/lib/i18n";
import { useReasoningEffort } from "@/lib/prefs";

interface UiMessage {
  id: number;
  role: "user" | "model";
  text: string;
  images?: ChatImage[];
  streaming?: boolean;
  failed?: boolean;
  model?: string;
  trying?: string;
  processSteps?: string[];
  elapsed?: number;
  _id?: string;
  _index?: string;
}

let nextId = 1;

function isConnectionLossError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (!(error instanceof Error)) return false;
  const msg = (error.message || "").toLowerCase();
  return (
    error.name === "TypeError" ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("fetch failed") ||
    msg.includes("load failed") ||
    msg.includes("connection") ||
    msg.includes("aborted")
  );
}



const WORKLOG_KEY = "agent.renstoolbox.worklog.v1";

type WorkLogSnapshot = {
  activities: ActivityItem[];
  assistantSnippet?: string;
  endHint?: "completed" | "completed_closed" | "failed" | "interrupted" | null;
  sessionId?: string | null;
  savedAt: number;
};

function loadWorkLog(): WorkLogSnapshot | null {
  try {
    const raw = sessionStorage.getItem(WORKLOG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkLogSnapshot;
    if (!parsed || !Array.isArray(parsed.activities)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveWorkLog(snapshot: WorkLogSnapshot) {
  try {
    sessionStorage.setItem(WORKLOG_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode */
  }
}

function clearWorkLog() {
  try {
    sessionStorage.removeItem(WORKLOG_KEY);
  } catch {
    /* ignore */
  }
}

type RunEndHint = "completed" | "completed_closed" | "failed" | "interrupted" | null;

function classifyRunEnd(opts: {
  aborted: boolean;
  connectionLost: boolean;
  hardError: boolean;
  activities: ActivityItem[];
  hadText: boolean;
}): { endHint: RunEndHint; failedMessage: boolean; finalizeAs: "error" | "interrupted" | "completed" } {
  const { aborted, connectionLost, hardError, activities, hadText } = opts;
  const useful = hasSuccessfulProgress(activities) || hadText;
  const toolErrors = hasToolErrors(activities);

  if (aborted) {
    return {
      endHint: useful ? "interrupted" : "interrupted",
      failedMessage: false,
      finalizeAs: "interrupted",
    };
  }
  if (toolErrors && !connectionLost) {
    return { endHint: "failed", failedMessage: true, finalizeAs: "error" };
  }
  if (connectionLost) {
    // Deferred restart / socket close after successful edits/builds → Completed
    // (connection closed). Never paint this as Interrupted/Failed.
    if (useful) {
      return {
        endHint: "completed_closed",
        failedMessage: false,
        finalizeAs: "completed",
      };
    }
    // Connection lost before useful work — Interrupted, not Failed.
    return {
      endHint: "interrupted",
      failedMessage: false,
      finalizeAs: "interrupted",
    };
  }
  if (hardError && !useful) {
    return { endHint: "failed", failedMessage: true, finalizeAs: "error" };
  }
  if (toolErrors) {
    return { endHint: "failed", failedMessage: true, finalizeAs: "error" };
  }
  return { endHint: "completed", failedMessage: false, finalizeAs: "completed" };
}

function toApiMessages(messages: UiMessage[]): ChatMessage[] {
  return messages
    .filter(
      (message) =>
        !message.failed && (message.text || (message.images?.length ?? 0) > 0)
    )
    .map(({ role, text, images }) => ({ role, text, images }));
}


function appendProcessStep(steps: string[] | undefined, step: string): string[] {
  const list = steps ?? [];
  if (list.includes(step)) return list;
  return [...list, step];
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
  const [reasoningEffort] = useReasoningEffort();

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  // const [shareMsg, setShareMsg] = useState<"link" | "error" | null>(null); // share feature removed
  const [flashId, setFlashId] = useState<number | null>(null);
  const handledMsgRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const userStoppedRef = useRef(false);
  const [freeNotice, setFreeNotice] = useState(false);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityLive, setActivityLive] = useState(false);
  const [activityEndHint, setActivityEndHint] = useState<RunEndHint>(null);
  const [activityRailOpen, setActivityRailOpen] = useState(false);
  const [assistantSnippet, setAssistantSnippet] = useState("");
  const activitiesRef = useRef<ActivityItem[]>([]);
  const restoredWorkLogRef = useRef(false);

  // Free-model notice: centered gray text, auto-dismisses after a few seconds.
  useEffect(() => {
    if (!freeNotice) return;
    const timer = setTimeout(() => setFreeNotice(false), 6000);
    return () => clearTimeout(timer);
  }, [freeNotice]);

  useEffect(() => {
    activitiesRef.current = activities;
  }, [activities]);

  // Restore last run work log after refresh so Activity trail survives reload.
  useEffect(() => {
    if (restoredWorkLogRef.current) return;
    restoredWorkLogRef.current = true;
    const snap = loadWorkLog();
    if (!snap?.activities?.length) return;
    setActivities(snap.activities);
    setActivityEndHint(snap.endHint ?? "completed");
    if (snap.assistantSnippet) setAssistantSnippet(snap.assistantSnippet);
  }, []);

  // Persist work log whenever the trail or end hint changes (not while empty+idle).
  useEffect(() => {
    if (!activities.length && !activityEndHint) return;
    saveWorkLog({
      activities,
      assistantSnippet: assistantSnippet || undefined,
      endHint: activityEndHint,
      sessionId: sessionIdRef.current,
      savedAt: Date.now(),
    });
  }, [activities, activityEndHint, assistantSnippet]);

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
    if (!id) {
      sessionIdRef.current = null;
      setActivities([]);
      setActivityEndHint(null);
      setAssistantSnippet("");
      clearWorkLog();
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
        processSteps: [],
      };
      setMessages([...base, modelMessage]);
      setSending(true);
      setFreeNotice(false);
      setActivities([]);
      activitiesRef.current = [];
      setActivityEndHint(null);
      setAssistantSnippet("");
      setActivityLive(true);
      clearWorkLog();

      const startedAt = Date.now();
      let elapsedValue = 0;
      const finalizeElapsed = () => {
        elapsedValue = Math.round((Date.now() - startedAt) / 100) / 10;
      };

      userStoppedRef.current = false;
      const controller = new AbortController();
      abortRef.current = controller;
      const history = toApiMessages(base);
      let aborted = false;

      let modelText = "";
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: lang,
            reasoning: reasoningEffort,
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
        let modelName: string | undefined;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const { text, model, trying, tryings, free, activities: incomingActivities } = parser.push(
            decoder.decode(value, { stream: true })
          );
          if (incomingActivities?.length) {
            setActivities((prev) => {
              const next = upsertActivity(prev, incomingActivities);
              activitiesRef.current = next;
              return next;
            });
          }
          if (free) {
            setFreeNotice(true);
          }
          if (model) {
            modelName = model;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === modelMessage.id
                  ? { ...message, model: modelName }
                  : message
              )
            );
          }
          const incomingSteps = tryings?.length
            ? tryings
            : trying
              ? [trying]
              : [];
          if (incomingSteps.length) {
            setMessages((prev) =>
              prev.map((message) => {
                if (message.id !== modelMessage.id) return message;
                let steps = message.processSteps ?? [];
                for (const step of incomingSteps) {
                  steps = appendProcessStep(steps, step);
                }
                return {
                  ...message,
                  trying: incomingSteps[incomingSteps.length - 1],
                  processSteps: steps,
                };
              })
            );
          }
          if (text) {
            // Ignore whitespace-only flushes so chips stay visible until
            // real answer tokens arrive (and still keep the trail after).
            if (!text.trim() && !modelText) {
              continue;
            }
            modelText += text;
            // Legacy sessions may still echo a <CONCLUDE> JSON tail —
            // never show it in the bubble (defense until it stops appearing).
            const openIdx = modelText.indexOf("<CONCLUDE>");
            const visible = openIdx === -1 ? modelText : modelText.slice(0, openIdx);
            setMessages((prev) =>
              prev.map((message) =>
                message.id === modelMessage.id
                  ? {
                      ...message,
                      text: visible,
                      trying: undefined,
                      // Keep processSteps as a completed trail above the answer.
                    }
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
        finalizeElapsed();
        setMessages((prev) =>
          prev.map((message) =>
            message.id === modelMessage.id
              ? {
                  ...message,
                  streaming: false,
                  trying: undefined,
                  // Retain processSteps trail for the completed turn.
                  elapsed: elapsedValue,
                }
              : message
          )
        );
        const finalized = finalizeRunningActivities(activitiesRef.current, "completed");
        setActivities(finalized);
        activitiesRef.current = finalized;
        setActivityEndHint("completed");
        setAssistantSnippet(modelText.trim().slice(0, 280));

        // Legacy defense: sessions whose context was built from the removed
        // persona may still echo the <CONCLUDE> JSON tail for a few messages —
        // strip it unconditionally from the bubble and the persisted text.
        const tailMatch = modelText.match(/<CONCLUDE>[\s\S]*?<\/CONCLUDE>/);
        const savedText = tailMatch
          ? modelText.slice(0, tailMatch.index).trimEnd()
          : modelText;
        if (tailMatch) {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === modelMessage.id
                ? { ...message, text: savedText }
                : message
            )
          );
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
        const isAbort =
          error instanceof DOMException && error.name === "AbortError";
        // Only treat AbortError as Interrupted when the user hit Stop.
        // Deferred restart / proxy close can also surface as AbortError —
        // if tools already succeeded, classify as Completed (connection closed).
        aborted = Boolean(isAbort && userStoppedRef.current);
        const connectionLost =
          !aborted && (isConnectionLossError(error) || isAbort);
        const hardError = !aborted && !connectionLost;
        const classification = classifyRunEnd({
          aborted,
          connectionLost,
          hardError,
          activities: activitiesRef.current,
          hadText: Boolean(modelText?.trim()),
        });
        const finalized = finalizeRunningActivities(
          activitiesRef.current,
          classification.finalizeAs
        );
        setActivities(finalized);
        activitiesRef.current = finalized;
        setActivityEndHint(classification.endHint);
        if (modelText?.trim()) {
          setAssistantSnippet(modelText.trim().slice(0, 280));
        }
        const lossMsg = t["chat.connectionLost"] || t["chat.requestFailed"];
        const keepTrail =
          aborted ||
          connectionLost ||
          classification.endHint === "completed_closed" ||
          classification.endHint === "completed";
        finalizeElapsed();
        let displayText: string | undefined;
        if (aborted) {
          displayText = undefined; // keep existing
        } else if (
          classification.endHint === "completed_closed" ||
          classification.endHint === "completed"
        ) {
          displayText = modelText; // may be empty — process trail is the product
        } else if (connectionLost) {
          displayText = modelText || lossMsg;
        } else {
          displayText =
            modelText ||
            (error instanceof Error ? error.message : t["chat.requestFailed"]);
        }
        setMessages((prev) =>
          prev.map((message) =>
            message.id === modelMessage.id
              ? {
                  ...message,
                  streaming: false,
                  failed: classification.failedMessage,
                  trying: undefined,
                  processSteps: keepTrail ? message.processSteps : [],
                  elapsed:
                    !classification.failedMessage ? elapsedValue : message.elapsed,
                  text: displayText === undefined ? message.text : displayText,
                }
              : message
          )
        );
      } finally {
        setSending(false);
        setActivityLive(false);
        abortRef.current = null;
      }
    },
    [isAuthed, lang, reasoningEffort]
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
    userStoppedRef.current = true;
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

  // Activity right-rail temporarily disabled — keep markers/stream, hide panel + mobile toggle.
  const SHOW_ACTIVITY_RAIL = false;
  const showActivityRail =
    SHOW_ACTIVITY_RAIL && (activityLive || sending || activities.length > 0);

  // Full-width chat when rail is off (no app-workspace grid / activity-rail).
  if (!showActivityRail) {
    return (
      <div className="app">
        {loading ? (
          <main className="messages">
            <p className="empty">{t["records.loading"]}</p>
          </main>
        ) : messages.length === 0 ? (
          <main className="welcome">
            <h2>{t["welcome.title"]}</h2>
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
      </div>
    );
  }

  return (
    <div className={`app-workspace${activityRailOpen ? " activity-open" : ""}`}>
      <div className="app app-center">
        {loading ? (
          <main className="messages">
            <p className="empty">{t["records.loading"]}</p>
          </main>
        ) : messages.length === 0 ? (
          <main className="welcome">
            <h2>{t["welcome.title"]}</h2>
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
      </div>
      {showActivityRail && (
        <>
          <button
            type="button"
            className="activity-rail-toggle"
            aria-expanded={activityRailOpen}
            aria-controls="activity-rail"
            onClick={() => setActivityRailOpen((open) => !open)}
          >
            {t["activity.title"] || "Activity"}
          </button>
          <aside
            id="activity-rail"
            className={`activity-rail${activityRailOpen ? " open" : ""}`}
            aria-label={t["activity.title"] || "Activity"}
          >
            <ActivityPanel
              items={activities}
              active={activityLive || sending}
              endHint={activityEndHint}
            />
          </aside>
        </>
      )}
    </div>
  );
}

