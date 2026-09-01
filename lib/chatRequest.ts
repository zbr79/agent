import { ChatValidationError } from "./errors";
import { isValidTimeZone } from "./prompt";
import { MAX_IMAGES, MAX_MESSAGES, type ChatImage, type ChatMessage } from "./types";

export interface ChatRequest {
  messages: ChatMessage[];
  timeZone?: string;
  language?: "zh" | "en";
  mode?: "preset" | "free";
}

function parseImage(raw: unknown, index: number): ChatImage {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { mimeType?: unknown }).mimeType !== "string" ||
    typeof (raw as { data?: unknown }).data !== "string"
  ) {
    throw new ChatValidationError(`messages[${index}].images contains an invalid image.`);
  }
  return raw as ChatImage;
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
      const { role, text, images } = raw as {
        role?: unknown;
        text?: unknown;
        images?: unknown;
      };
      if (role !== "user" && role !== "model") {
        throw new ChatValidationError(`messages[${index}].role must be "user" or "model".`);
      }
      if (typeof text !== "string") {
        throw new ChatValidationError(`messages[${index}].text must be a string.`);
      }
      let parsedImages: ChatImage[] | undefined;
      if (images !== undefined && images !== null) {
        if (!Array.isArray(images) || images.length > MAX_IMAGES) {
          throw new ChatValidationError(
            `messages[${index}].images must be an array of at most ${MAX_IMAGES} images.`
          );
        }
        parsedImages = images.map((image) => parseImage(image, index));
      }
      return { role, text, images: parsedImages };
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

  const rawMode = (body as { mode?: unknown }).mode;
  let mode: "preset" | "free" | undefined;
  if (rawMode !== undefined) {
    if (rawMode !== "preset" && rawMode !== "free") {
      throw new ChatValidationError('"mode" must be "preset" or "free".');
    }
    mode = rawMode;
  }

  return { messages, timeZone, language, mode };
}
