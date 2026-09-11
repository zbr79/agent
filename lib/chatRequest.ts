import { ChatValidationError } from "./errors";
import { isValidTimeZone } from "./prompt";
import { MAX_IMAGES, MAX_MESSAGES, type ChatImage, type ChatMessage } from "./types";

export interface ChatRequest {
  messages: ChatMessage[];
  timeZone?: string;
  language?: "zh" | "en";
  reasoning?: "balance" | "max";
  mode?: "build" | "plan";
  model?: "deepseek-v4-flash" | "qwen3.8-flash" | "glm-5.3-flash";
  sessionId?: string;
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

  const rawReasoning = (body as { reasoning?: unknown }).reasoning;
  let reasoning: "balance" | "max" | undefined;
  if (rawReasoning !== undefined) {
    // Legacy clients may still send "medium" (old default label) or "low" —
    // normalize both: medium → balance, low → max.
    if (rawReasoning === "low") {
      reasoning = "max";
    } else if (rawReasoning === "medium") {
      reasoning = "balance";
    } else if (rawReasoning !== "max" && rawReasoning !== "balance") {
      throw new ChatValidationError('"reasoning" must be "max" or "balance".');
    } else {
      reasoning = rawReasoning;
    }
  }

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

  return { messages, timeZone, language, reasoning, mode, model, sessionId };
}
