import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, type ChatMessage } from "./types";

const SYSTEM_PROMPT =
  "You are GemChat, a friendly and concise assistant. Answer clearly, use plain language, and format longer answers with markdown. When the user sends an image, describe or analyze it carefully.";

export class ChatValidationError extends Error {}

function getApiKey(): string {
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

export async function* streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const stream = await ai.models.generateContentStream({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: toContents(messages),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.7,
    },
  });
  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) yield text;
  }
}
