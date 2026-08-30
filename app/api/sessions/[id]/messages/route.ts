import { appendMessage, truncateMessages } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_TEXT = 100_000;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  let role: "user" | "model";
  let text: string;
  let image: { mimeType: string; data: string } | undefined;
  let model: string | undefined;
  let elapsed: number | undefined;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      throw new Error("Request body must be a JSON object.");
    }
    const { role: rawRole, text: rawText, image: rawImage, model: rawModel, elapsed: rawElapsed } = body as {
      role?: unknown;
      text?: unknown;
      image?: unknown;
      model?: unknown;
      elapsed?: unknown;
    };
    if (rawRole !== "user" && rawRole !== "model") {
      throw new Error('"role" must be "user" or "model".');
    }
    role = rawRole;
    if (typeof rawText !== "string" || rawText.length > MAX_TEXT) {
      throw new Error('"text" must be a string within size limits.');
    }
    text = rawText;
    if (rawImage !== undefined && rawImage !== null) {
      if (
        typeof rawImage !== "object" ||
        typeof (rawImage as { mimeType?: unknown }).mimeType !== "string" ||
        typeof (rawImage as { data?: unknown }).data !== "string"
      ) {
        throw new Error('"image" is invalid.');
      }
      image = rawImage as { mimeType: string; data: string };
    }
    if (rawModel !== undefined && rawModel !== null) {
      if (typeof rawModel !== "string" || rawModel.length > 100) {
        throw new Error('"model" is invalid.');
      }
      model = rawModel;
    }
    if (rawElapsed !== undefined && rawElapsed !== null) {
      if (typeof rawElapsed !== "number" || rawElapsed < 0 || rawElapsed > 3600) {
        throw new Error('"elapsed" is invalid.');
      }
      elapsed = rawElapsed;
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request body." },
      { status: 400 }
    );
  }

  try {
    const message = await appendMessage(auth._id, id, { role, text, image, model, elapsed });
    if (!message) {
      return Response.json({ error: "Session not found." }, { status: 404 });
    }
    return Response.json({ message }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save the message.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  let keep: number;
  try {
    const body: unknown = await req.json();
    const rawKeep = body && typeof body === "object"
      ? (body as { keep?: unknown }).keep
      : undefined;
    if (typeof rawKeep !== "number" || !Number.isInteger(rawKeep) || rawKeep < 1) {
      throw new Error('"keep" must be a positive integer.');
    }
    keep = rawKeep;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request body." },
      { status: 400 }
    );
  }

  try {
    const removed = await truncateMessages(auth._id, id, keep);
    return Response.json({ removed });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not revert messages.";
    return Response.json({ error: message }, { status: 500 });
  }
}
