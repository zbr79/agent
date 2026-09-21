import { MAX_ATTACHMENTS } from "../attachments/limits";

export const MAX_DOCUMENTS = MAX_ATTACHMENTS;
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
export const MAX_DOCUMENT_TEXT = 80_000;
export const MAX_TOTAL_DOCUMENT_TEXT = 160_000;
export const MAX_DOCUMENT_SOURCE_TEXT = 24_000;
export const MAX_DOCUMENT_SOURCES = 400;

export const DOCUMENT_TYPES = {
  "text/plain": ".txt",
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
} as const;

export const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set(Object.values(DOCUMENT_TYPES));
