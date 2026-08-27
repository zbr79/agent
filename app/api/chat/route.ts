import { streamChat, ChatValidationError } from "@/lib/gemini";
import { recordRequest, recordError } from "@/lib/usage";
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
  try {
    messages = parseBody(await req.json());
  } catch (error) {
    const message =
      error instanceof ChatValidationError
        ? error.message
        : "Invalid request body.";
    return Response.json({ error: message }, { status: 400 });
  }

  const encoder = new TextEncoder();
  recordRequest();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const text of streamChat(messages)) {
          controller.enqueue(encoder.encode(text));
        }
      } catch (error) {
        if (!(error instanceof ChatValidationError)) {
          recordError();
        }
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
