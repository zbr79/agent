import { ChatValidationError, getSystemPrompt } from "./gemini";
import { encodeModelMarker } from "./markers";
import { insertCall } from "./db";
import type { ChatMessage } from "./types";

export const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";
export const OPENCODE_MODEL = "deepseek-v4-pro";

export function getOpenCodeKey(): string {
  const key = process.env.OPENCODE_API_KEY;
  if (!key || key === "your_opencode_go_api_key_here" || key === "your_api_key_here") {
    throw new ChatValidationError(
      "OPENCODE_API_KEY is not configured on the server."
    );
  }
  return key;
}

export interface OpenCodeUsageWindow {
  status: string;
  percent: number;
  resetsAt: string;
}

export interface OpenCodeOfficialUsage {
  rolling: OpenCodeUsageWindow;
  weekly: OpenCodeUsageWindow;
  monthly: OpenCodeUsageWindow;
}

let officialCache: { at: number; data: OpenCodeOfficialUsage } | null = null;

export async function getOpenCodeOfficialUsage(): Promise<OpenCodeOfficialUsage | null> {
  const now = Date.now();
  if (officialCache && now - officialCache.at < 60_000) {
    return officialCache.data;
  }
  try {
    const response = await fetch(`${OPENCODE_BASE_URL}/usage`, {
      headers: { Authorization: `Bearer ${getOpenCodeKey()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      usage?: Partial<OpenCodeOfficialUsage>;
    };
    const usage = body.usage;
    if (!usage?.rolling || !usage.weekly || !usage.monthly) return null;
    const data = {
      rolling: usage.rolling,
      weekly: usage.weekly,
      monthly: usage.monthly,
    };
    officialCache = { at: now, data };
    return data;
  } catch {
    return null;
  }
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function toOpenAiMessages(
  messages: ChatMessage[],
  timeZone?: string,
  language?: "zh" | "en"
): OpenAiMessage[] {
  const out: OpenAiMessage[] = [
    { role: "system", content: getSystemPrompt(timeZone, language) },
  ];
  for (const message of messages) {
    if (message.image) {
      throw new ChatValidationError(
        "The OpenCode page is text-only; images are not supported."
      );
    }
    if (!message.text.trim()) continue;
    out.push({
      role: message.role === "model" ? "assistant" : "user",
      content: message.text,
    });
  }
  return out;
}

interface OpenAiChunk {
  choices?: { delta?: { content?: string | null } }[];
  error?: { message?: string };
}

export async function* streamOpenCodeChat(
  messages: ChatMessage[],
  timeZone?: string,
  language?: "zh" | "en"
): AsyncGenerator<string> {
  const requestId = Math.random().toString(36).slice(2, 8);
  const body = {
    model: OPENCODE_MODEL,
    messages: toOpenAiMessages(messages, timeZone, language),
    stream: true,
    temperature: 0.7,
  };
  console.log(`[opencode:${requestId}] start — ${body.messages.length} messages`);

  const response = await fetch(`${OPENCODE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenCodeKey()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let message = `OpenCode request failed (HTTP ${response.status}).`;
    try {
      const parsed = JSON.parse(text) as OpenAiChunk;
      if (parsed.error?.message) message = parsed.error.message;
    } catch {}
    insertCall({
      kind: "opencode",
      model: OPENCODE_MODEL,
      ok: false,
      error: message.slice(0, 300),
    }).catch(() => {});
    throw new Error(message);
  }

  yield encodeModelMarker(OPENCODE_MODEL);
  console.log(
    `[opencode:${requestId}] connected ${OPENCODE_MODEL}, waiting for first token`
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let produced = false;
  let failed: Error | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let chunk: OpenAiChunk;
        try {
          chunk = JSON.parse(data) as OpenAiChunk;
        } catch {
          continue;
        }
        if (chunk.error?.message) {
          throw new Error(chunk.error.message);
        }
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) {
          produced = true;
          yield text;
        }
      }
    }
  } catch (error) {
    failed = error instanceof Error ? error : new Error(String(error));
  }

  if (failed) {
    insertCall({
      kind: "opencode",
      model: OPENCODE_MODEL,
      ok: false,
      error: failed.message.slice(0, 300),
    }).catch(() => {});
    console.log(
      `[opencode:${requestId}] stream error → ${failed.message.slice(0, 200)}`
    );
    throw failed;
  }
  if (!produced) {
    const error = new Error("OpenCode stream ended with no content.");
    insertCall({
      kind: "opencode",
      model: OPENCODE_MODEL,
      ok: false,
      error: error.message,
    }).catch(() => {});
    throw error;
  }
  insertCall({ kind: "opencode", model: OPENCODE_MODEL, ok: true }).catch(() => {});
  console.log(`[opencode:${requestId}] done — answered by ${OPENCODE_MODEL}`);
}
