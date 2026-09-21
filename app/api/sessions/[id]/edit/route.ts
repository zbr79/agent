import { requireUser } from "@/lib/auth";
import { CheckpointConflictError, rewindSession } from "@/lib/rewind";
import { appendMessage, getSessionWorkspace } from "@/lib/db";
import type { ChatImage } from "@/lib/types";
import { parseDocumentAttachment } from "@/lib/chatRequest";
import { MAX_ATTACHMENTS } from "@/lib/attachments/limits";
import { hasDuplicateAttachmentNames } from "@/lib/attachments/validation";
import { MAX_DOCUMENTS, MAX_TOTAL_DOCUMENT_TEXT } from "@/lib/documents/limits";
import type { DocumentAttachment } from "@/lib/documents/types";

export const runtime = "nodejs";

const MAX_TEXT = 100_000;
const MAX_MESSAGE_ID = 64;

function parseImages(value: unknown): ChatImage[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    throw new Error(`"images" must be an array of at most ${MAX_ATTACHMENTS} images.`);
  }
  return value.map((image) => {
    if (
      typeof image !== "object" ||
      image === null ||
      typeof (image as { mimeType?: unknown }).mimeType !== "string" ||
      typeof (image as { data?: unknown }).data !== "string" ||
      ((image as { name?: unknown }).name !== undefined &&
        typeof (image as { name?: unknown }).name !== "string")
    ) {
      throw new Error('"images" contains an invalid image.');
    }
    return image as ChatImage;
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    const raw: unknown = await req.json();
    if (!raw || typeof raw !== "object") {
      return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    body = raw as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  let messageId: string | undefined;
  let keep: number;
  let text: string;
  let images: ChatImage[] | undefined;
  let documents: DocumentAttachment[] | undefined;
  try {
    if (body.messageId !== undefined && body.messageId !== null) {
      if (typeof body.messageId !== "string" || body.messageId.length > MAX_MESSAGE_ID) {
        throw new Error('"messageId" is invalid.');
      }
      messageId = body.messageId;
    }
    if (
      typeof body.keep !== "number" ||
      !Number.isInteger(body.keep) ||
      body.keep < 0
    ) {
      throw new Error('"keep" must be a non-negative integer.');
    }
    keep = body.keep;
    if (typeof body.text !== "string" || body.text.length > MAX_TEXT || !body.text.trim()) {
      throw new Error('"text" must be a non-empty string within size limits.');
    }
    text = body.text.trim();
    images = parseImages(body.images);
    if (body.documents !== undefined && body.documents !== null) {
      if (!Array.isArray(body.documents) || body.documents.length > MAX_DOCUMENTS) {
        throw new Error(`"documents" must be an array of at most ${MAX_DOCUMENTS} documents.`);
      }
      documents = body.documents.map((document, index) =>
        parseDocumentAttachment(document, index)
      );
      if (documents.reduce((sum, document) => sum + document.text.length, 0) > MAX_TOTAL_DOCUMENT_TEXT) {
        throw new Error('"documents" contain too much extracted text.');
      }
    }
    if ((images?.length ?? 0) + (documents?.length ?? 0) > MAX_ATTACHMENTS) {
      throw new Error(`Attachments must contain at most ${MAX_ATTACHMENTS} items.`);
    }
    if (hasDuplicateAttachmentNames(images, documents)) {
      throw new Error("Attachments contain duplicate file names.");
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request body." },
      { status: 400 }
    );
  }

  try {
    if (!(await getSessionWorkspace(auth._id, id))) {
      return Response.json({ error: "Session not found." }, { status: 404 });
    }

    const rewind = await rewindSession({
      userId: auth._id,
      sessionId: id,
      keep,
      restoreMessageId: messageId,
    });

    const message = await appendMessage(auth._id, id, {
      role: "user",
      text,
      images,
      documents,
    });
    if (!message) {
      return Response.json({ error: "Session not found." }, { status: 404 });
    }
    return Response.json(
      { message, removed: rewind.removed, restored: rewind.restored },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof CheckpointConflictError) {
      return Response.json(
        { error: error.message, preview: error.preview },
        { status: 409 }
      );
    }
    console.error("[sessions/edit] failed", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The edited message could not be prepared.",
      },
      { status: 500 }
    );
  }
}
