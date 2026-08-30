import { concludeMessage } from "@/lib/conclude";
import { ChatValidationError } from "@/lib/errors";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 16_000;
const MAX_CONTEXT_LENGTH = 4_000;

export async function POST(req: Request) {
  let text: string;
  let context: string | undefined;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      throw new ChatValidationError("Request body must be a JSON object.");
    }
    const { text: rawText, context: rawContext } = body as {
      text?: unknown;
      context?: unknown;
    };
    if (typeof rawText !== "string" || !rawText.trim()) {
      throw new ChatValidationError('"text" must be a non-empty string.');
    }
    text = rawText;
    if (text.length > MAX_TEXT_LENGTH) {
      throw new ChatValidationError(
        `"text" is too long. Max ${MAX_TEXT_LENGTH} characters.`
      );
    }
    if (rawContext !== undefined) {
      if (typeof rawContext !== "string") {
        throw new ChatValidationError('"context" must be a string.');
      }
      if (rawContext.length > MAX_CONTEXT_LENGTH) {
        throw new ChatValidationError(
          `"context" is too long. Max ${MAX_CONTEXT_LENGTH} characters.`
        );
      }
      context = rawContext;
    }
  } catch (error) {
    const message =
      error instanceof ChatValidationError
        ? error.message
        : "Invalid request body.";
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    const result = await concludeMessage(text, context);
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof ChatValidationError
        ? error.message
        : error instanceof Error && error.message
          ? `Conclude request failed: ${error.message}`
          : "Conclude request failed. See README.";
    return Response.json({ error: message }, { status: 502 });
  }
}
