import { ChatValidationError } from "@/lib/errors";
import { parseChatBody, type ChatRequest } from "@/lib/chatRequest";
import {
  chatErrorMessage,
  isBalanceError,
  quotaResetInfo,
  streamChat,
} from "@/lib/opencode";
import { encodeLimitMarker } from "@/lib/markers";

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      req.signal.addEventListener("abort", () => {
        console.log("[opencode] client disconnected mid-stream");
      });
      try {
        for await (const text of streamChat(messages, timeZone, language, freeMode)) {
          controller.enqueue(encoder.encode(text));
        }
      } catch (error) {
        const message =
          error instanceof ChatValidationError
            ? error.message
            : await chatErrorMessage(error, language);
        if (!(error instanceof ChatValidationError) && isBalanceError(error)) {
          const { window, resetAt } = await quotaResetInfo();
          if (resetAt) controller.enqueue(encoder.encode(encodeLimitMarker(`${window}|${resetAt}`)));
        }
        controller.enqueue(encoder.encode(`\n\n[${message}]`));
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
