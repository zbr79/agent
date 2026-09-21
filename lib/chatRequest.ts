import { ChatValidationError } from "./errors";
import { MAX_ATTACHMENTS } from "./attachments/limits";
import { hasDuplicateAttachmentNames } from "./attachments/validation";
import {
  MAX_DOCUMENTS,
  MAX_DOCUMENT_SOURCE_TEXT,
  MAX_DOCUMENT_SOURCES,
  MAX_DOCUMENT_TEXT,
  MAX_TOTAL_DOCUMENT_TEXT,
} from "./documents/limits";
import type { DocumentAttachment, DocumentSource } from "./documents/types";
import { isValidTimeZone } from "./prompt";
import {
  MAX_MESSAGES,
  WORKSPACE_IDS,
  type ChatImage,
  type ChatMessage,
  type WorkspaceId,
} from "./types";

export interface ChatRequest {
  messages: ChatMessage[];
  timeZone?: string;
  language?: "zh" | "en";
  reasoning?: "max";
  mode?: "build" | "plan";
  model?: "deepseek-v4-flash" | "qwen3.8-flash" | "glm-5.3-flash";
  sessionId?: string;
  messageId?: string;
  workspaceId?: WorkspaceId;
}

function parseImage(raw: unknown, index: number): ChatImage {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { mimeType?: unknown }).mimeType !== "string" ||
    typeof (raw as { data?: unknown }).data !== "string" ||
    ((raw as { name?: unknown }).name !== undefined &&
      typeof (raw as { name?: unknown }).name !== "string")
  ) {
    throw new ChatValidationError(`messages[${index}].images contains an invalid image.`);
  }
  return raw as ChatImage;
}

function parseDocumentSource(raw: unknown, index: number): DocumentSource {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof (raw as { locator?: unknown }).locator !== "string" ||
    typeof (raw as { label?: unknown }).label !== "string" ||
    typeof (raw as { text?: unknown }).text !== "string"
  ) {
    throw new ChatValidationError(`messages[${index}].documents contains an invalid source.`);
  }
  const source = raw as DocumentSource;
  if (source.text.length > MAX_DOCUMENT_SOURCE_TEXT) {
    throw new ChatValidationError(`messages[${index}].documents contains an oversized source.`);
  }
  return source;
}

export function parseDocumentAttachment(raw: unknown, index = 0): DocumentAttachment {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof (raw as { id?: unknown }).id !== "string" ||
    typeof (raw as { name?: unknown }).name !== "string" ||
    typeof (raw as { mimeType?: unknown }).mimeType !== "string" ||
    typeof (raw as { size?: unknown }).size !== "number" ||
    typeof (raw as { text?: unknown }).text !== "string" ||
    !Array.isArray((raw as { sources?: unknown }).sources)
  ) {
    throw new ChatValidationError(`messages[${index}].documents contains an invalid document.`);
  }
  const document = raw as DocumentAttachment;
  if (
    document.id.length > 128 ||
    document.name.length > 160 ||
    document.size < 0 ||
    document.text.length === 0 ||
    document.text.length > MAX_DOCUMENT_TEXT ||
    document.sources.length > MAX_DOCUMENT_SOURCES
  ) {
    throw new ChatValidationError(`messages[${index}].documents contains an invalid document.`);
  }
  return {
    ...document,
    sources: document.sources.map((source) => parseDocumentSource(source, index)),
  };
}

export function parseChatBody(body: unknown): ChatRequest {
  if (!body || typeof body !== "object") {
    throw new ChatValidationError("Request body must be a JSON object.");
  }
  const rawMessages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new ChatValidationError('"messages" must be a non-empty array.');
  }
  const messages = rawMessages
    .slice(-MAX_MESSAGES)
    .map((raw, index): ChatMessage => {
      if (!raw || typeof raw !== "object") {
        throw new ChatValidationError(`messages[${index}] is invalid.`);
      }
      const { role, text, images, documents } = raw as {
        role?: unknown;
        text?: unknown;
        images?: unknown;
        documents?: unknown;
      };
      if (role !== "user" && role !== "model") {
        throw new ChatValidationError(`messages[${index}].role must be "user" or "model".`);
      }
      if (typeof text !== "string") {
        throw new ChatValidationError(`messages[${index}].text must be a string.`);
      }
      let parsedImages: ChatImage[] | undefined;
      if (images !== undefined && images !== null) {
        if (!Array.isArray(images) || images.length > MAX_ATTACHMENTS) {
          throw new ChatValidationError(
            `messages[${index}].images must be an array of at most ${MAX_ATTACHMENTS} images.`
          );
        }
        parsedImages = images.map((image) => parseImage(image, index));
      }
      let parsedDocuments: DocumentAttachment[] | undefined;
      if (documents !== undefined && documents !== null) {
        if (!Array.isArray(documents) || documents.length > MAX_DOCUMENTS) {
          throw new ChatValidationError(
            `messages[${index}].documents must be an array of at most ${MAX_DOCUMENTS} documents.`
          );
        }
        parsedDocuments = documents.map((document) => parseDocumentAttachment(document, index));
        const totalText = parsedDocuments.reduce((sum, document) => sum + document.text.length, 0);
        if (totalText > MAX_TOTAL_DOCUMENT_TEXT) {
          throw new ChatValidationError(
            `messages[${index}].documents contain too much extracted text.`
          );
        }
      }
      const attachmentCount = (parsedImages?.length ?? 0) + (parsedDocuments?.length ?? 0);
      if (attachmentCount > MAX_ATTACHMENTS) {
        throw new ChatValidationError(
          `messages[${index}] must contain at most ${MAX_ATTACHMENTS} attachments.`
        );
      }
      if (hasDuplicateAttachmentNames(parsedImages, parsedDocuments)) {
        throw new ChatValidationError(`messages[${index}] contains duplicate attachment names.`);
      }
      return { role, text, images: parsedImages, documents: parsedDocuments };
    });

  const rawZone = (body as { timeZone?: unknown }).timeZone;
  let timeZone: string | undefined;
  if (rawZone !== undefined) {
    if (!isValidTimeZone(rawZone)) {
      throw new ChatValidationError('"timeZone" is invalid.');
    }
    timeZone = rawZone;
  }

  const rawLanguage = (body as { language?: unknown }).language;
  let language: "zh" | "en" | undefined;
  if (rawLanguage !== undefined) {
    if (rawLanguage !== "zh" && rawLanguage !== "en") {
      throw new ChatValidationError('"language" must be "zh" or "en".');
    }
    language = rawLanguage;
  }

  // Effort picker is gone; every chat uses max. Accept leftover client
  // values so old tabs do not 400, then ignore them.
  const reasoning: "max" = "max";

  const rawModel = (body as { model?: unknown }).model;
  let model: "deepseek-v4-flash" | "qwen3.8-flash" | "glm-5.3-flash" | undefined;
  if (rawModel !== undefined && rawModel !== null) {
    if (
      rawModel !== "deepseek-v4-flash" &&
      rawModel !== "qwen3.8-flash" &&
      rawModel !== "glm-5.3-flash"
    ) {
      throw new ChatValidationError(
        '"model" must be "deepseek-v4-flash", "qwen3.8-flash", or "glm-5.3-flash".'
      );
    }
    model = rawModel;
  }
  // Selection is strict: DeepSeek V4 Flash has no vision, so an image send on
  // it is rejected here (and pre-blocked in the composer) rather than silently
  // rerouted to another model.
  if (model === "deepseek-v4-flash" && (messages[messages.length - 1]?.images?.length ?? 0) > 0) {
    throw new ChatValidationError(
      language === "zh"
        ? "DeepSeek V4 Flash 无法识别图片，请移除图片，或改用 Qwen / GLM。"
        : "DeepSeek V4 Flash cannot read images — remove the image or switch to Qwen / GLM."
    );
  }

  const rawMode = (body as { mode?: unknown }).mode;
  let mode: "build" | "plan" | undefined;
  if (rawMode !== undefined) {
    if (rawMode !== "build" && rawMode !== "plan") {
      throw new ChatValidationError('"mode" must be "build" or "plan".');
    }
    mode = rawMode;
  }

  const rawSessionId = (body as { sessionId?: unknown }).sessionId;
  let sessionId: string | undefined;
  if (rawSessionId !== undefined && rawSessionId !== null) {
    // Lenient on purpose: guest ids are client-generated UUIDs. Owned
    // sessions persist on the user; guest ids persist on guestRuns.
    if (typeof rawSessionId !== "string" || rawSessionId.length > 64) {
      throw new ChatValidationError('"sessionId" is invalid.');
    }
    sessionId = rawSessionId;
  }

  const rawMessageId = (body as { messageId?: unknown }).messageId;
  let messageId: string | undefined;
  if (rawMessageId !== undefined && rawMessageId !== null) {
    if (typeof rawMessageId !== "string" || rawMessageId.length > 64) {
      throw new ChatValidationError('"messageId" is invalid.');
    }
    messageId = rawMessageId;
  }

  const rawWorkspaceId = (body as { workspaceId?: unknown }).workspaceId;
  let workspaceId: WorkspaceId | undefined;
  if (rawWorkspaceId !== undefined) {
    if (
      typeof rawWorkspaceId !== "string" ||
      !WORKSPACE_IDS.includes(rawWorkspaceId as WorkspaceId)
    ) {
      throw new ChatValidationError('"workspaceId" is invalid.');
    }
    workspaceId = rawWorkspaceId as WorkspaceId;
  }

  return {
    messages,
    timeZone,
    language,
    reasoning,
    mode,
    model,
    sessionId,
    messageId,
    workspaceId,
  };
}
