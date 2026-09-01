import {
  chatErrorMessage,
  getOpenCodeOfficialUsage,
  isBalanceError,
  quotaResetInfo,
  streamChat,
} from "@/lib/opencode";
import { agentChat, isAgentUp } from "@/lib/agent";
import { ChatValidationError } from "@/lib/errors";
import { encodeLimitMarker } from "@/lib/markers";
import { parseChatBody, type ChatRequest } from "@/lib/chatRequest";

export const runtime = "nodejs";

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
  const { messages, timeZone, language, mode } = parsed;
  const freeMode = mode === "free";
  const hasImage = messages.some((message) => (message.images?.length ?? 0) > 0);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      req.signal.addEventListener("abort", () => {
        console.log("[chat] client disconnected mid-stream");
      });
      const enqueue = (text: string) => controller.enqueue(encoder.encode(text));

      try {
        if (!hasImage) {
          // Skip the agent entirely when the subscription is exhausted — the
          // opencode server hangs on prompts instead of failing fast, and the
          // direct path surfaces the friendly limit banner immediately.
          const official = await getOpenCodeOfficialUsage();
          const quotaExhausted =
            official !== null &&
            (official.monthly?.status === "rate-limited" ||
              official.rolling.percent >= 100);
          const agentReady = !quotaExhausted && (await isAgentUp());
          if (agentReady) {
            let produced = false;
            try {
              for await (const text of agentChat(messages, timeZone, language, freeMode)) {
                produced = true;
                enqueue(text);
              }
              return;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.log(`[chat] agent failed${produced ? " mid-stream" : ""} → ${message.slice(0, 160)}`);
              if (produced) return;
            }
          }
        }
        for await (const text of streamChat(messages, timeZone, language, freeMode)) {
          enqueue(text);
        }
      } catch (error) {
        const message =
          error instanceof ChatValidationError
            ? error.message
            : await chatErrorMessage(error, language);
        if (!(error instanceof ChatValidationError) && isBalanceError(error)) {
          const { window, resetAt } = await quotaResetInfo();
          if (resetAt) enqueue(encodeLimitMarker(`${window}|${resetAt}`));
        }
        enqueue(`\n\n[${message}]`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
