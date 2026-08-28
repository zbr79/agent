import { streamChat, ChatValidationError, isValidTimeZone } from "@/lib/gemini";
import { MAX_MESSAGES, type ChatImage, type ChatMessage } from "@/lib/types";

export const runtime = "nodejs";

function parseBody(body: unknown): ChatMessage[] {
  if (!body || typeof body !== "object") {
    throw new ChatValidationError("Request body must be a JSON object.");
  }
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ChatValidationError('"messages" must be a non-empty array.');
  }
  return messages
    .slice(-MAX_MESSAGES)
    .map((raw, index): ChatMessage => {
      if (!raw || typeof raw !== "object") {
        throw new ChatValidationError(`messages[${index}] is invalid.`);
      }
      const { role, text, image } = raw as Partial<ChatMessage>;
      if (role !== "user" && role !== "model") {
        throw new ChatValidationError(`messages[${index}].role must be "user" or "model".`);
      }
      if (typeof text !== "string") {
        throw new ChatValidationError(`messages[${index}].text must be a string.`);
      }
      let parsedImage: ChatMessage["image"];
      if (image !== undefined && image !== null) {
        if (
          typeof image !== "object" ||
          typeof (image as { mimeType?: unknown }).mimeType !== "string" ||
          typeof (image as { data?: unknown }).data !== "string"
        ) {
          throw new ChatValidationError(`messages[${index}].image is invalid.`);
        }
        parsedImage = image as ChatImage;
      }
      return { role, text, image: parsedImage };
    });
}

export async function POST(req: Request) {
  let messages: ChatMessage[];
  let timeZone: string | undefined;
  try {
    const body: unknown = await req.json();
    messages = parseBody(body);
    const rawZone = body && typeof body === "object"
      ? (body as { timeZone?: unknown }).timeZone
      : undefined;
    if (rawZone !== undefined) {
      if (!isValidTimeZone(rawZone)) {
        throw new ChatValidationError('"timeZone" is invalid.');
      }
      timeZone = rawZone;
    }
  } catch (error) {
    const message =
      error instanceof ChatValidationError
        ? error.message
        : "Invalid request body.";
    return Response.json({ error: message }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      req.signal.addEventListener("abort", () => {
        console.log("[chat] client disconnected mid-stream");
      });
      try {
        for await (const text of streamChat(messages, timeZone)) {
          controller.enqueue(encoder.encode(text));
        }
      } catch (error) {
        const message =
          error instanceof ChatValidationError
            ? error.message
            : error instanceof Error && error.message
              ? `Chat request failed: ${error.message}`
              : "Chat request failed. See README.";
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
