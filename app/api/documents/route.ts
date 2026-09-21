import { randomUUID } from "node:crypto";
import { ChatValidationError } from "@/lib/errors";
import {
  DOCUMENT_EXTENSIONS,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS,
  MAX_TOTAL_DOCUMENT_TEXT,
} from "@/lib/documents/limits";
import { DocumentExtractionError, extractDocument } from "@/lib/documents/extract";
import type { DocumentAttachment } from "@/lib/documents/types";

export const runtime = "nodejs";

function safeName(value: string): string {
  const name = value.replace(/[/\\]/g, "_").trim().slice(0, 160);
  return name || "document";
}

function extensionOf(name: string): string {
  return name.slice(name.lastIndexOf(".")).toLowerCase();
}

function typeIsAllowed(name: string, type: string): boolean {
  const extension = extensionOf(name);
  if (!DOCUMENT_EXTENSIONS.has(extension)) return false;
  const expectedType = Object.entries(DOCUMENT_TYPES).find(([, value]) => value === extension)?.[0];
  return !type || type === "application/octet-stream" || type === expectedType;
}

function normalizedType(name: string, type: string): string {
  return (
    Object.entries(DOCUMENT_TYPES).find(([, value]) => value === extensionOf(name))?.[0] ?? type
  );
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Upload must use multipart form data." }, { status: 400 });
  }

  const files = form
    .getAll("files")
    .filter((value): value is File => typeof File !== "undefined" && value instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "Choose at least one document." }, { status: 400 });
  }
  if (files.length > MAX_DOCUMENTS) {
    return Response.json(
      { error: `You can attach up to ${MAX_DOCUMENTS} documents per message.` },
      { status: 400 }
    );
  }

  const documents: DocumentAttachment[] = [];
  const errors: string[] = [];
  const seenNames = new Set<string>();
  let totalText = 0;
  for (const file of files) {
    try {
      const name = safeName(file.name);
      const normalizedName = name.trim().toLocaleLowerCase();
      if (seenNames.has(normalizedName)) {
        errors.push(`${name}: duplicate file name.`);
        continue;
      }
      seenNames.add(normalizedName);
      if (!typeIsAllowed(name, file.type)) {
        throw new ChatValidationError(`${name} is not a supported document type.`);
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        throw new ChatValidationError(
          `${name} is too large. Documents must be ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB or smaller.`
        );
      }
      const extracted = await extractDocument(
        name,
        file.type,
        Buffer.from(await file.arrayBuffer())
      );
      if (!extracted.text) {
        throw new ChatValidationError(`${name} does not contain readable text.`);
      }
      totalText += extracted.text.length;
      if (totalText > MAX_TOTAL_DOCUMENT_TEXT) {
        throw new ChatValidationError("The combined extracted document text is too large.");
      }
      documents.push({
        id: randomUUID(),
        name,
        mimeType: normalizedType(name, file.type),
        size: file.size,
        text: extracted.text,
        sources: extracted.sources,
      });
    } catch (error) {
      console.error("[documents] extraction failed", {
        name: file.name,
        type: file.type,
        error: error instanceof Error ? error.stack || error.message : error,
      });
      errors.push(
        error instanceof ChatValidationError || error instanceof DocumentExtractionError
          ? error.message
          : `${safeName(file.name)} could not be processed.`
      );
    }
  }

  if (documents.length === 0) {
    return Response.json(
      { error: errors.join(" ") || "Could not process the documents." },
      { status: 400 }
    );
  }
  return Response.json({ documents, errors });
}
