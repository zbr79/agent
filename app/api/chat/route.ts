import {
  chatErrorMessage,
  getOpenCodeOfficialUsage,
  imageExhaustedText,
  isBalanceError,
  quotaResetInfo,
  streamChat,
} from "@/lib/opencode";
import { agentChat, isAgentUp } from "@/lib/agent";
import { ChatValidationError } from "@/lib/errors";
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
  // Only the latest message decides whether this send is an image request;
  // earlier photos in the history must not re-route text sends to the
  // paid-only vision chain.
  const lastMessage = messages[messages.length - 1];
  const hasImage = (lastMessage?.images?.length ?? 0) > 0;

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
        if (!(error instanceof ChatValidationError) && isBalanceError(error) && hasImage) {
          // Vision model is paid-only: the reply itself says the image
          // quota is gone and when it resets (no red banner anymore).
          const { resetAt } = await quotaResetInfo();
          enqueue(imageExhaustedText(language, resetAt));
        } else {
          enqueue(`\n\n[${message}]`);
        }
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
