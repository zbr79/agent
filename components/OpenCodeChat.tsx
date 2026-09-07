"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { formatLimitReset, parseLimitPayload, type LimitWindow } from "@/lib/format";
import { AlertTriangle } from "lucide-react";
import { STR, useUiLang } from "@/lib/i18n";

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



const WORKLOG_KEY = "agent.renstoolbox.opencode.worklog.v1";

type WorkLogSnapshot = {
  activities: ActivityItem[];
  assistantSnippet?: string;
  endHint?: "completed" | "completed_closed" | "failed" | "interrupted" | null;
  savedAt: number;
};

type RunEndHint = "completed" | "completed_closed" | "failed" | "interrupted" | null;

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
    /* ignore */
  }
}

function clearWorkLog() {
  try {
    sessionStorage.removeItem(WORKLOG_KEY);
  } catch {
    /* ignore */
  }
}

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
    return { endHint: "interrupted", failedMessage: false, finalizeAs: "interrupted" };
  }
  if (toolErrors && !connectionLost) {
    return { endHint: "failed", failedMessage: true, finalizeAs: "error" };
  }
  if (connectionLost) {
    // Deferred restart disconnect after successful work → Completed (connection closed).
    if (useful) {
      return { endHint: "completed_closed", failedMessage: false, finalizeAs: "completed" };
    }
    return { endHint: "interrupted", failedMessage: false, finalizeAs: "interrupted" };
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

export default function OpenCodeChat() {
  const lang = useUiLang();
  const t = STR[lang];
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [limitReset, setLimitReset] = useState<number | null>(null);
  const [limitWindow, setLimitWindow] = useState<LimitWindow | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityLive, setActivityLive] = useState(false);
  const [activityEndHint, setActivityEndHint] = useState<RunEndHint>(null);
  const [activityRailOpen, setActivityRailOpen] = useState(false);
  const activitiesRef = useRef<ActivityItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const userStoppedRef = useRef(false);
  const restoredWorkLogRef = useRef(false);

  useEffect(() => {
    activitiesRef.current = activities;
  }, [activities]);

  useEffect(() => {
    if (restoredWorkLogRef.current) return;
    restoredWorkLogRef.current = true;
    const snap = loadWorkLog();
    if (!snap?.activities?.length) return;
    setActivities(snap.activities);
    setActivityEndHint(snap.endHint ?? "completed");
  }, []);

  useEffect(() => {
    if (!activities.length && !activityEndHint) return;
    saveWorkLog({
      activities,
      endHint: activityEndHint,
      savedAt: Date.now(),
    });
  }, [activities, activityEndHint]);

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
        processSteps: [],
      };
      const history = toApiMessages([...messages, userMessage]);
      setMessages((prev) => [...prev, userMessage, modelMessage]);
      setSending(true);
      setActivities([]);
      activitiesRef.current = [];
      setActivityEndHint(null);
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

      let modelText = "";
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
          await response.text();
          throw new Error(t["chat.requestFailed"]);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new ModelMarkerParser();
        let modelName: string | undefined;
        let limitHit = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const { text, model, trying, tryings, limit, activities: incomingActivities } = parser.push(
            decoder.decode(value, { stream: true })
          );
          if (incomingActivities?.length) {
            setActivities((prev) => {
              const next = upsertActivity(prev, incomingActivities);
              activitiesRef.current = next;
              return next;
            });
          }
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
          if (text && !limitHit) {
            // Ignore whitespace-only flushes so chips stay visible until
            // real answer tokens arrive (and still keep the trail after).
            if (!text.trim() && !modelText) {
              continue;
            }
            modelText += text;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === modelMessage.id
                  ? {
                      ...message,
                      text: message.text + text,
                      trying: undefined,
                      // Keep processSteps as a completed trail above the answer.
                    }
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
        finalizeElapsed();
        setMessages((prev) =>
          prev.map((message) =>
            message.id === modelMessage.id
              ? {
                  ...message,
                  streaming: false,
                  elapsed: elapsedValue,
                  trying: undefined,
                  // Retain processSteps trail for the completed turn.
                }
              : message
          )
        );
        const finalized = finalizeRunningActivities(activitiesRef.current, "completed");
        setActivities(finalized);
        activitiesRef.current = finalized;
        setActivityEndHint("completed");
      } catch (error) {
        const isAbort =
          error instanceof DOMException && error.name === "AbortError";
        const aborted = Boolean(isAbort && userStoppedRef.current);
        const connectionLost =
          !aborted && (isConnectionLossError(error) || isAbort);
        const hardError = !aborted && !connectionLost;
        const classification = classifyRunEnd({
          aborted,
          connectionLost,
          hardError,
          activities: activitiesRef.current,
          hadText: Boolean(modelText.trim()),
        });
        const finalized = finalizeRunningActivities(
          activitiesRef.current,
          classification.finalizeAs
        );
        setActivities(finalized);
        activitiesRef.current = finalized;
        setActivityEndHint(classification.endHint);
        const lossMsg = t["chat.connectionLost"] || t["chat.requestFailed"];
        const keepTrail =
          aborted ||
          connectionLost ||
          classification.endHint === "completed_closed" ||
          classification.endHint === "completed";
        finalizeElapsed();
        let displayText: string | undefined;
        if (aborted) {
          displayText = undefined;
        } else if (
          classification.endHint === "completed_closed" ||
          classification.endHint === "completed"
        ) {
          displayText = modelText;
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
                  elapsed: !classification.failedMessage ? elapsedValue : message.elapsed,
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
    [messages, sending, lang, t]
  );

  const stop = useCallback(() => {
    userStoppedRef.current = true;
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

  // Activity right-rail temporarily disabled — keep markers/stream, hide panel + mobile toggle.
  const SHOW_ACTIVITY_RAIL = false;
  const showActivityRail =
    SHOW_ACTIVITY_RAIL && (activityLive || sending || activities.length > 0);

  if (!showActivityRail) {
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
            <Composer
              sending={sending}
              onSend={send}
              onStop={stop}
              disabled={limitReset !== null}
              placeholder={t["composer.placeholder"]}
            />
          </main>
        ) : (
          <>
            <MessageBubble messages={messages} guest={false} />
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
              placeholder={t["composer.placeholder"]}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`app-workspace${activityRailOpen ? " activity-open" : ""}`}>
      <div className="app app-center">
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
            <Composer
              sending={sending}
              onSend={send}
              onStop={stop}
              disabled={limitReset !== null}
              placeholder={t["composer.placeholder"]}
            />
          </main>
        ) : (
          <>
            <MessageBubble messages={messages} guest={false} />
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
              placeholder={t["composer.placeholder"]}
            />
          </>
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

