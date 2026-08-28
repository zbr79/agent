import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, type Content, type GenerateContentResponse, type Part } from "@google/genai";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, type ChatMessage } from "./types";
import { getChatChain } from "./models";
import { recordError, recordQuotaExhausted, recordRequest } from "./usage";
import { insertCall } from "./db";
import { encodeModelMarker, encodeTryingMarker } from "./markers";

// The persona lives in SYSTEM_PROMPT.md (project root) so it can be edited
// without touching code; re-read per request so edits apply without a restart.
const PROMPT_FILE = path.join(process.cwd(), "SYSTEM_PROMPT.md");
const FALLBACK_PROMPT =
  "You are InsChat, a friendly and concise assistant. Answer clearly, use plain language, and format longer answers with markdown.";

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function currentTimeLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(new Date());
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}年${get("month")}月${get("day")}日 ${get("dayPeriod")} ${get("hour")}:${get("minute")}`;
  } catch {
    return new Date().toISOString();
  }
}

function getSystemPrompt(timeZone?: string): string {
  const zone =
    timeZone && isValidTimeZone(timeZone)
      ? timeZone
      : process.env.RECORD_TIMEZONE || "Asia/Shanghai";
  try {
    const prompt = fs.readFileSync(PROMPT_FILE, "utf8").trim();
    if (prompt) {
      return `${prompt}\n\n当前时间（${zone}）: ${currentTimeLabel(zone)}`;
    }
  } catch {}
  return FALLBACK_PROMPT;
}

export class ChatValidationError extends Error {}

export function isQuotaError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return message.includes("RESOURCE_EXHAUSTED") || message.includes("429");
}

export function isUnavailableError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return /404|not found|retired|discontinued|does not exist/i.test(message);
}

export function isOverloadedError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return message.includes("503");
}

export function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "REPLACE_WITH_YOUR_KEY" || key === "your_api_key_here") {
    throw new ChatValidationError(
      "GEMINI_API_KEY is not configured on the server. See README for setup steps."
    );
  }
  return key;
}

export function toContents(messages: ChatMessage[]): Content[] {
  return messages.map((message): Content => {
    const parts: Part[] = [];
    if (message.image) {
      const mimeType = message.image.mimeType.toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
        throw new ChatValidationError(
          `Unsupported image type: ${mimeType}. Allowed: JPEG, PNG, WebP.`
        );
      }
      const bytes = Math.floor((message.image.data.length * 3) / 4);
      if (bytes > MAX_IMAGE_BYTES) {
        throw new ChatValidationError("Image is too large. Max size is 5 MB.");
      }
      parts.push({
        inlineData: { mimeType, data: message.image.data },
      });
    }
    if (message.text) {
      parts.push({ text: message.text });
    }
    return { role: message.role === "model" ? "model" : "user", parts };
  });
}

export async function* streamChat(
  messages: ChatMessage[],
  timeZone?: string
): AsyncGenerator<string> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const contents = toContents(messages);
  const chain = getChatChain();
  const systemPrompt = getSystemPrompt(timeZone);

  const requestId = Math.random().toString(36).slice(2, 8);
  const imageBytes = contents.reduce(
    (sum, content) =>
      sum +
      (content.parts ?? []).reduce(
        (partSum, part) =>
          partSum + (part.inlineData?.data ? part.inlineData.data.length : 0),
        0
      ),
    0
  );
  console.log(
    `[chat:${requestId}] start — ${contents.length} contents, image b64 ~${Math.round(imageBytes / 1024)} KB, chain ${chain.length} models`
  );

  let lastError: unknown = null;

  for (const model of chain) {
    let stream: AsyncGenerator<GenerateContentResponse> | null = null;
    for (let attempt = 0; attempt < 3 && !stream; attempt++) {
      try {
        console.log(`[chat:${requestId}] trying ${model} (attempt ${attempt + 1})`);
        yield encodeTryingMarker(model);
        stream = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7,
          },
        });
      } catch (error) {
        lastError = error;
        const skip = isQuotaError(error) || isUnavailableError(error);
        if (skip) {
          if (isQuotaError(error)) {
            recordQuotaExhausted(model);
            console.log(`[chat:${requestId}] ${model} quota exhausted → next model`);
          } else {
            console.log(`[chat:${requestId}] ${model} unavailable → next model`);
          }
          insertCall({
            kind: "chat",
            model,
            ok: false,
            error: String(
              error instanceof Error ? error.message : error
            ).slice(0, 300),
          }).catch(() => {});
          break;
        }
        if (isOverloadedError(error)) {
          const delay = 1500 * (attempt + 1);
          console.log(`[chat:${requestId}] ${model} overloaded (503) → retry in ${delay}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        console.log(
          `[chat:${requestId}] ${model} unexpected error → ${String(error instanceof Error ? error.message : error).slice(0, 200)}`
        );
        if (error instanceof ChatValidationError) throw error;
        throw error;
      }
    }
    if (!stream) continue;

    recordRequest(model);
    console.log(`[chat:${requestId}] connected ${model}, waiting for first token`);
    try {
      yield encodeModelMarker(model);
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) yield text;
      }
      insertCall({ kind: "chat", model, ok: true }).catch(() => {});
      console.log(`[chat:${requestId}] done — answered by ${model}`);
      return;
    } catch (error) {
      lastError = error;
      insertCall({
        kind: "chat",
        model,
        ok: false,
        error: String(error instanceof Error ? error.message : error).slice(0, 300),
      }).catch(() => {});
      console.log(
        `[chat:${requestId}] ${model} stream error → ${String(error instanceof Error ? error.message : error).slice(0, 200)}`
      );
      throw error;
    }
  }

  if (!(lastError instanceof ChatValidationError)) {
    recordError();
  }
  console.log(`[chat:${requestId}] failed — all ${chain.length} models unavailable`);
  throw lastError ?? new Error("Chat request failed: all models unavailable.");
}
