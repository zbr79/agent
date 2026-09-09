import {
  chatErrorMessage,
  imageExhaustedText,
  isBalanceError,
  quotaResetInfo,
  streamChat,
} from "@/lib/opencode";
import {
  AgentBusyError,
  agentChat,
  ensureBoundSession,
  injectVisionExchange,
  isAgentUp,
  lookupAgentModel,
  type AgentRunResult,
} from "@/lib/agent";
import { ChatValidationError } from "@/lib/errors";
import { parseChatBody, type ChatRequest } from "@/lib/chatRequest";
import { getUserFromRequest } from "@/lib/auth";
import {
  activityTrailLabel,
  encodeKeepMarker,
  ModelMarkerParser,
  type ActivityEvent,
} from "@/lib/markers";
import { AGENT_ROOT } from "@/lib/pathJail";
import {
  finalizeGuestRun,
  finalizeMessage,
  getAgentBinding,
  getGuestAgentBinding,
  listAgentTranscript,
  setAgentBinding,
  setGuestAgentBinding,
  startGuestPendingRun,
  startPendingModelMessage,
  updateGuestRunProgress,
  updateMessageProgress,
} from "@/lib/db";
import type { AgentBinding, ChatMessage } from "@/lib/types";

export const runtime = "nodejs";

const MAX_PERSIST_TEXT = 100_000;
const PROGRESS_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

// In-flight runs that own a pending Mongo doc. A `pm2 restart agent` (the
// deferred recycle after DONE) sends SIGINT/SIGTERM; the handlers below then
// flush every live run to "done" with the text streamed so far, instead of
// leaving the placeholder pending until the stale sweep unlocks the composer.
type RunFlush = () => void;
type GlobalWithLiveRuns = typeof globalThis & { __agentLiveChatRuns?: Map<string, RunFlush> };
function getLiveRuns(): Map<string, RunFlush> {
  const g = globalThis as GlobalWithLiveRuns;
  if (!g.__agentLiveChatRuns) g.__agentLiveChatRuns = new Map();
  return g.__agentLiveChatRuns;
}

let shutdownHooksInstalled = false;
function installShutdownFlush(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  const flush = () => {
    for (const fn of Array.from(getLiveRuns().values())) {
      try {
        fn();
      } catch {
        /* best effort: process exit may still win the race */
      }
    }
  };
  process.on("SIGTERM", flush);
  process.on("SIGINT", flush);
}

export async function POST(req: Request) {
  let parsed: ChatRequest;
  try {
    parsed = parseChatBody(await req.json());
  } catch (error) {
    const message =
      error instanceof ChatValidationError
        ? error.message
        : "Invalid request body.";
    return Response.json({ error: message }, { status: 400 });
  }
  const { messages, language, reasoning, mode, model, sessionId } = parsed;
  // Only the latest message decides whether this send is an image request;
  // earlier photos in the history must not re-route text sends to the
  // paid-only vision chain.
  const lastMessage = messages[messages.length - 1];
  const hasImage = (lastMessage?.images?.length ?? 0) > 0;

  // Server-side run persistence (signed-in users with an owned session):
  // insert a pending model message before generating, stream progress into
  // it, and finalize it when the run ends. The answer then survives
  // refreshes, tab closes, and client disconnects.
  let runMessageId: string | null = null;
  let guestSessionId: string | null = null;
  let runUserId: string | null = null;
  if (sessionId) {
    try {
      const user = await getUserFromRequest(req);
      if (user) {
        runUserId = user._id;
        const pending = await startPendingModelMessage(user._id, sessionId);
        runMessageId = pending?._id ?? null;
      }
      // Guest ids are UUIDs with no owned Mongo session. Still persist the
      // in-flight model message so a hard refresh can restore the trail.
      if (!runMessageId) {
        const guest = await startGuestPendingRun(sessionId);
        guestSessionId = guest ? sessionId : null;
      }
    } catch {
      runMessageId = null;
      guestSessionId = null;
    }
  }
  const persistedRun = runMessageId !== null || guestSessionId !== null;
  // Snapshot before the run can null it out: finishRun resets runMessageId
  // when the stream ends, which may happen before the headers are built.
  const runMessageIdForHeader = runMessageId;
  const accountBound = runMessageId !== null && runUserId !== null;
  const guestBound = runMessageId === null && guestSessionId !== null;
  const ownerKey =
    accountBound && runUserId && sessionId
      ? `u:${runUserId}:${sessionId}`
      : guestBound && sessionId
        ? `g:${sessionId}`
        : null;

  // Persistent opencode thread for this chat. The agent path prompts ONLY
  // the new message into this session (real memory); first turns, rebuilds
  // after the session died, and the direct-engine fallback keep using the
  // full transcript the client sends anyway.
  let binding: AgentBinding | null = null;
  if (persistedRun && sessionId) {
    try {
      binding = accountBound
        ? await getAgentBinding(runUserId as string, sessionId)
        : await getGuestAgentBinding(sessionId);
    } catch {
      binding = null;
    }
  }
  const saveBinding = (next: AgentBinding | null) => {
    if (!sessionId || (!accountBound && !guestBound)) return;
    if (accountBound) {
      setAgentBinding(runUserId as string, sessionId, next).catch(() => {});
    } else {
      setGuestAgentBinding(sessionId, next).catch(() => {});
    }
  };
  if (persistedRun) {
    console.log(`[chat] pending ${runMessageId ? "session" : "guest"} ${sessionId}`);
    // Register with the shutdown flush so a restart mid-run still finalizes.
    installShutdownFlush();
  }

  const startedAt = Date.now();
  const elapsedSeconds = () => Math.round((Date.now() - startedAt) / 100) / 10;
  const parser = new ModelMarkerParser();
  let accText = "";
  let accModel: string | undefined;
  let lastProgressAt = 0;
  const trail: { id: string; label: string }[] = [];

  const trailKey = (item: string) =>
    item
      .replace(/\s*\(\+\d+\s+-\d+\)\s*$/, "")
      .replace(/\s*[\u2713\u2717]\s*$/, "")
      .trim()
      .toLowerCase();

  const shortTarget = (value: string | undefined) => {
    if (!value) return value;
    const prefix = `${AGENT_ROOT}/`;
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
  };

  const snapshotSteps = () => trail.map((step) => step.label);

  const upsertTrail = (id: string, label: string) => {
    const clean = label.replace(/^\s*→\s+/, "").trim().slice(0, 180);
    if (!clean) return;
    const key = trailKey(clean);
    const idx = trail.findIndex((step) => step.id === id || trailKey(step.label) === key);
    if (idx >= 0) {
      trail[idx] = { id: trail[idx].id.startsWith("trying:") ? id : trail[idx].id, label: clean };
      return;
    }
    trail.push({ id, label: clean });
    if (trail.length > 80) trail.shift();
  };

  const noteTrying = (label: string) => {
    const clean = label.replace(/^\s*→\s+/, "").trim().slice(0, 180);
    if (!clean) return;
    const key = trailKey(clean);
    if (trail.some((step) => trailKey(step.label) === key || trailKey(step.label).includes(key))) {
      return;
    }
    upsertTrail(`trying:${clean}`, clean);
  };

  const noteActivity = (event: ActivityEvent) => {
    const shortened: ActivityEvent = {
      ...event,
      path: shortTarget(event.path),
      title: shortTarget(event.title),
    };
    const label = activityTrailLabel(shortened);
    if (!label) return;
    const target = (shortened.path || shortened.title || "").trim().toLowerCase();
    if (target) {
      const drop = trail.findIndex(
        (step) => step.id.startsWith("trying:") && trailKey(step.label) === target
      );
      if (drop >= 0) trail.splice(drop, 1);
    }
    upsertTrail(event.id, label);
  };

  const noteTextTrail = (chunk: string) => {
    for (const raw of chunk.split("\n")) {
      const match = raw.match(/^\s*→\s+(.+)$/);
      if (!match?.[1]) continue;
      upsertTrail(`text:${trailKey(match[1])}`, match[1]);
    }
  };

  const persistProgress = (force = false) => {
    if (!runMessageId && !guestSessionId) return;
    const now = Date.now();
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    const payload = {
      text: accText.slice(0, MAX_PERSIST_TEXT),
      model: accModel,
      elapsed: elapsedSeconds(),
      processSteps: snapshotSteps(),
    };
    if (runMessageId) updateMessageProgress(runMessageId, payload).catch(() => {});
    if (guestSessionId) updateGuestRunProgress(guestSessionId, payload).catch(() => {});
  };
  const runKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const finishRun = (status: "done" | "failed", extra = "") => {
    getLiveRuns().delete(runKey);
    if (!runMessageId && !guestSessionId) return;
    const tail = parser.flush();
    if (tail) noteTextTrail(tail);
    const text = `${accText}${tail}${extra}`.slice(0, MAX_PERSIST_TEXT);
    const payload = {
      text,
      model: accModel,
      elapsed: elapsedSeconds(),
      status,
      processSteps: snapshotSteps(),
    };
    if (runMessageId) finalizeMessage(runMessageId, payload).catch(() => {});
    if (guestSessionId) finalizeGuestRun(guestSessionId, payload).catch(() => {});
    runMessageId = null;
    guestSessionId = null;
  };
  // Liveness heartbeat: proves the run is still executing even when tools
  // run for minutes without emitting text, so the stale-pending sweep in
  // getSessionWithMessages only fires for genuinely dead runs. It also pushes
  // a no-op KEEP marker down the stream — without bytes leaving the server,
  // nginx's read timeout (or a phone backgrounding the tab) drops the
  // connection even though the run is perfectly healthy.
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  if (persistedRun) {
    getLiveRuns().set(runKey, () => finishRun("done"));
  }
  const collect = persistedRun
    ? (chunk: string) => {
        const out = parser.push(chunk);
        if (out.model) accModel = out.model;
        let meaningful = false;
        if (out.tryings?.length) {
          for (const step of out.tryings) noteTrying(step);
          meaningful = true;
        } else if (out.trying) {
          noteTrying(out.trying);
          meaningful = true;
        }
        if (out.activities?.length) {
          for (const event of out.activities) noteActivity(event);
          meaningful = true;
        }
        if (out.text) {
          accText += out.text;
          if (out.text.includes("\u2192")) {
            noteTextTrail(out.text);
            meaningful = true;
          }
        }
        if (meaningful) persistProgress(true);
        else if (out.text) persistProgress();
      }
    : () => {};
  async function* tapped(source: AsyncGenerator<string>): AsyncGenerator<string> {
    for await (const text of source) {
      collect(text);
      yield text;
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      req.signal.addEventListener("abort", () => {
        console.log("[chat] client disconnected mid-stream");
      });
      // A disconnect must not abort the run: enqueue failures flip to
      // detached mode and the generator keeps pumping so the persisted
      // copy of the answer still completes.
      let detached = false;
      const enqueue = (text: string) => {
        if (detached) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          detached = true;
          console.log("[chat] stream cancelled → run continues detached");
        }
      };
      if (persistedRun) {
        heartbeat = setInterval(() => {
          persistProgress(true);
          enqueue(encodeKeepMarker());
        }, HEARTBEAT_INTERVAL_MS);
      }

      try {
        try {
          const modelWindow = await lookupAgentModel().catch(() => null);
          const attachOnSession = Boolean(hasImage && modelWindow?.image);
          async function priorTurns(): Promise<ChatMessage[]> {
            const fromRequest = messages.slice(0, -1).map((message) => ({
              role: message.role,
              text: message.text,
            }));
            if (accountBound && runUserId && sessionId) {
              try {
                const stored = await listAgentTranscript(runUserId, sessionId);
                if (stored.length) {
                  const copy = stored.slice();
                  const tail = copy[copy.length - 1];
                  const lastReq = messages[messages.length - 1];
                  if (
                    tail &&
                    lastReq &&
                    tail.role === "user" &&
                    tail.text === lastReq.text
                  ) {
                    copy.pop();
                  }
                  return copy;
                }
              } catch {
                /* request history is enough to rebuild */
              }
            }
            return fromRequest;
          }
          async function runBoundAgent(unbindOnMiss: boolean): Promise<"ok" | "busy" | "fail"> {
            if (!(await isAgentUp())) return "fail";
            let produced = false;
            const out: AgentRunResult = {};
            try {
              for await (const text of tapped(
                agentChat({
                  messages,
                  language,
                  agentTools: true,
                  mode,
                  binding,
                  out,
                  ownerKey,
                  priorTurns: await priorTurns(),
                  onSessionReady: (id) =>
                    saveBinding({ sessionId: id, tokens: binding?.tokens ?? 0 }),
                })
              )) {
                produced = true;
                enqueue(text);
              }
              if (out.agentSessionId) {
                saveBinding({
                  sessionId: out.agentSessionId,
                  tokens: out.lastInputTokens ?? 0,
                });
                binding = { sessionId: out.agentSessionId, tokens: out.lastInputTokens ?? 0 };
              }
              finishRun("done");
              return "ok";
            } catch (error) {
              if (error instanceof AgentBusyError) {
                enqueue(
                  "\n\n[A reply is already in progress for this chat. Wait for it to finish.]"
                );
                finishRun("failed", "\n\n[A reply is already in progress for this chat.]");
                return "busy";
              }
              const message = error instanceof Error ? error.message : String(error);
              console.log(
                `[chat] agent failed${produced ? " mid-stream" : ""} → ${message.slice(0, 160)}`
              );
              if (produced) {
                if (out.agentSessionId) {
                  saveBinding({
                    sessionId: out.agentSessionId,
                    tokens: out.lastInputTokens ?? 0,
                  });
                }
                finishRun("done");
                return "ok";
              }
              if (out.agentSessionId) {
                binding = { sessionId: out.agentSessionId, tokens: binding?.tokens ?? 0 };
              }
              if (unbindOnMiss) saveBinding(null);
              return "fail";
            }
          }

          if (!hasImage || attachOnSession) {
            const ran = await runBoundAgent(!hasImage);
            if (ran === "ok" || ran === "busy") return;
          }
          if (!hasImage) {
            let produced = false;
            try {
              for await (const text of tapped(
                streamChat(messages, language, reasoning, model)
              )) {
                produced = true;
                enqueue(text);
              }
              finishRun("done");
              return;
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              console.log(
                `[chat] direct failed${produced ? " mid-stream" : ""} → ${message.slice(0, 160)}`
              );
              if (produced) {
                finishRun("done");
                return;
              }
              throw error;
            }
          }
          for await (const text of tapped(
            streamChat(messages, language, reasoning, model)
          )) {
            enqueue(text);
          }
          finishRun("done");
          // Vision fallback for this one turn. Write the assistant text back
          // onto the bound opencode session so the next text turn still has it.
          const assistantText = accText;
          let sid = binding?.sessionId ?? null;
          if (ownerKey) {
            try {
              const ensured = await ensureBoundSession(ownerKey, sid);
              if (ensured) {
                sid = ensured;
                saveBinding({ sessionId: sid, tokens: binding?.tokens ?? 0 });
              }
            } catch {
              /* keep the text path working even if session create fails */
            }
          }
          if (sid && assistantText.trim()) {
            injectVisionExchange(sid, lastMessage?.text ?? "", assistantText).catch(() => {});
          }
        } catch (error) {
          const message =
            error instanceof ChatValidationError
              ? error.message
              : await chatErrorMessage(error, language);
          let note: string;
          if (
            !(error instanceof ChatValidationError) &&
            isBalanceError(error) &&
            hasImage
          ) {
            // Vision model is paid-only: the reply itself says the image
            // quota is gone and when it resets (no red banner anymore).
            const { resetAt } = await quotaResetInfo();
            note = imageExhaustedText(language, resetAt);
          } else {
            note = `\n\n[${message}]`;
          }
          enqueue(note);
          finishRun("failed", note);
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        // Belt and braces: any path that returns early without finalizing
        // still releases the pending doc instead of hanging the client.
        if (runMessageId || guestSessionId) {
          finishRun("failed", accText ? "" : "[The run ended unexpectedly.]");
        }
        try {
          controller.close();
        } catch {
          /* stream already closed / detached */
        }
      }
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  };
  if (persistedRun) headers["X-Run-Persisted"] = "1";
  // Lets the browser close its own pending placeholder on the clean-end
  // path (robust even if this handler dies microseconds later). Guests key on
  // the session id itself, so no id header needed for them.
  if (runMessageIdForHeader) headers["X-Run-Message-Id"] = runMessageIdForHeader;

  return new Response(stream, { headers });
}
