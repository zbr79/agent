import { streamChat } from "@/lib/opencode";
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
  const { messages, timeZone, language } = parsed;
  const hasImage = messages.some((message) => message.image);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      req.signal.addEventListener("abort", () => {
        console.log("[chat] client disconnected mid-stream");
      });
      const enqueue = (text: string) => controller.enqueue(encoder.encode(text));

      try {
        if (!hasImage) {
          const agentReady = await isAgentUp();
          if (agentReady) {
            let produced = false;
            try {
              for await (const text of agentChat(messages, timeZone, language)) {
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
        for await (const text of streamChat(messages, timeZone, language)) {
          enqueue(text);
        }
      } catch (error) {
        const message =
          error instanceof ChatValidationError
            ? error.message
            : error instanceof Error && error.message
              ? `Chat request failed: ${error.message}`
              : "Chat request failed. See README.";
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
