import { insertShare } from "@/lib/db";

export const runtime = "nodejs";

const MAX_MESSAGES = 50;
const MAX_TEXT = 100_000;

export async function POST(req: Request) {
  let kind: "chat" | "message";
  let title: string;
  let messages: {
    role: "user" | "model";
    text: string;
    image?: { mimeType: string; data: string };
    model?: string;
    elapsed?: number;
  }[] = [];
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      throw new Error("Request body must be a JSON object.");
    }
    const { kind: rawKind, title: rawTitle, messages: rawMessages } = body as {
      kind?: unknown;
      title?: unknown;
      messages?: unknown;
    };
    if (rawKind !== "chat" && rawKind !== "message") {
      throw new Error('"kind" must be "chat" or "message".');
    }
    kind = rawKind;
    if (typeof rawTitle !== "string" || !rawTitle.trim() || rawTitle.length > 200) {
      throw new Error('"title" is invalid.');
    }
    title = rawTitle.trim();
    if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > MAX_MESSAGES) {
      throw new Error(`"messages" must contain 1–${MAX_MESSAGES} entries.`);
    }
    messages = rawMessages.map((raw, index) => {
      if (!raw || typeof raw !== "object") {
        throw new Error(`messages[${index}] is invalid.`);
      }
      const { role, text, images, model, elapsed } = raw as {
        role?: unknown;
        text?: unknown;
        images?: unknown;
        model?: unknown;
        elapsed?: unknown;
      };
      if (role !== "user" && role !== "model") {
        throw new Error(`messages[${index}].role must be "user" or "model".`);
      }
      if (typeof text !== "string" || text.length > MAX_TEXT) {
        throw new Error(`messages[${index}].text is invalid.`);
      }
      let parsedImages: { mimeType: string; data: string }[] | undefined;
      if (images !== undefined && images !== null) {
        if (!Array.isArray(images) || images.length > 3) {
          throw new Error(`messages[${index}].images must be an array of at most 3 images.`);
        }
        parsedImages = images.map((image) => {
          if (
            typeof image !== "object" ||
            image === null ||
            typeof (image as { mimeType?: unknown }).mimeType !== "string" ||
            typeof (image as { data?: unknown }).data !== "string"
          ) {
            throw new Error(`messages[${index}].images contains an invalid image.`);
          }
          return image as { mimeType: string; data: string };
        });
      }
      return {
        role,
        text,
        images: parsedImages,
        model: typeof model === "string" ? model.slice(0, 100) : undefined,
        elapsed: typeof elapsed === "number" ? elapsed : undefined,
      };
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request body." },
      { status: 400 }
    );
  }

  try {
    const token = await insertShare({ kind, title, messages });
    return Response.json({ token }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create the share.";
    return Response.json({ error: message }, { status: 500 });
  }
}
