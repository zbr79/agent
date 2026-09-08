import {
  chatErrorMessage,
  imageExhaustedText,
  isBalanceError,
  quotaResetInfo,
  streamChat,
} from "@/lib/opencode";
import { agentChat, isAgentUp } from "@/lib/agent";
import { ChatValidationError } from "@/lib/errors";
import { parseChatBody, type ChatRequest } from "@/lib/chatRequest";
import { getUserFromRequest } from "@/lib/auth";
import { activityTrailLabel, ModelMarkerParser, type ActivityEvent } from "@/lib/markers";
import { AGENT_ROOT } from "@/lib/pathJail";
import {
  finalizeGuestRun,
  finalizeMessage,
  startGuestPendingRun,
  startPendingModelMessage,
  updateGuestRunProgress,
  updateMessageProgress,
} from "@/lib/db";

export const runtime = "nodejs";

const MAX_PERSIST_TEXT = 100_000;
const PROGRESS_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

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
  const { messages, language, reasoning, mode, sessionId } = parsed;
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
  if (sessionId) {
    try {
      const user = await getUserFromRequest(req);
      if (user) {
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
  if (persistedRun) {
    console.log(`[chat] pending ${runMessageId ? "session" : "guest"} ${sessionId}`);
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
  const finishRun = (status: "done" | "failed", extra = "") => {
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
  // getSessionWithMessages only fires for genuinely dead runs.
  const heartbeat = persistedRun
    ? setInterval(() => persistProgress(true), HEARTBEAT_INTERVAL_MS)
    : null;
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

      try {
        try {
          if (!hasImage) {
            // Agent first: this product is the agent site. Prefer local
            // filesystem tools (read/glob/edit) via opencode serve, matching
            // /api/opencode. Fall back to the direct zen engine only when the
            // agent is down or fails before producing any tokens.
            if (await isAgentUp()) {
              let produced = false;
              try {
                for await (const text of tapped(
                  agentChat(messages, language, true, mode)
                )) {
                  produced = true;
                  enqueue(text);
                }
                finishRun("done");
                return;
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.log(
                  `[chat] agent failed${produced ? " mid-stream" : ""} → ${message.slice(0, 160)}`
                );
                if (produced) {
                  finishRun("done");
                  return;
                }
              }
            }
            let produced = false;
            try {
              for await (const text of tapped(
                streamChat(messages, language, reasoning)
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
            streamChat(messages, language, reasoning)
          )) {
            enqueue(text);
          }
          finishRun("done");
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

  return new Response(stream, { headers });
}
