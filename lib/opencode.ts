import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChatValidationError } from "./errors";
import { getSystemPrompt } from "./prompt";
import { encodeModelMarker, encodeTryingMarker } from "./markers";
import { getChatChain } from "./models";
import { insertCall } from "./db";
import { fetchPageText } from "./webfetch";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, type ChatMessage } from "./types";

export const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";
export const OPENCODE_MODEL = "deepseek-v4-pro";
export const OPENCODE_VISION_MODEL = "deepseek-v4-flash-vision-exp";

// The opencode CLI stores the current subscription key here; it changes when
// the user rotates/reconnects the key in the TUI. Prefer it over .env so the
// app never runs on a stale (exhausted) key.
function keyFromAuthFile(): string | null {
  try {
    const file = path.join(
      os.homedir(),
      ".local",
      "share",
      "opencode",
      "auth.json"
    );
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      { key?: string }
    >;
    const key = parsed["opencode-go"]?.key;
    if (typeof key === "string" && key) return key;
  } catch {}
  return null;
}

export function getOpenCodeKey(): string {
  // OPENCODE_API_KEY_FORCE=1 pins the app to the .env key even when the
  // opencode CLI has a different (newer) key in auth.json — useful for
  // deliberately testing the exhausted-key state.
  const envKey = process.env.OPENCODE_API_KEY;
  const key =
    process.env.OPENCODE_API_KEY_FORCE === "1"
      ? envKey
      : keyFromAuthFile() ?? envKey;
  if (!key || key === "your_opencode_go_api_key_here" || key === "your_api_key_here") {
    throw new ChatValidationError(
      "OPENCODE_API_KEY is not configured on the server."
    );
  }
  return key;
}

export function isQuotaError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return /429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(message);
}

export function isUnavailableError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return /404|not found|not supported|does not exist|ModelError|retired/i.test(message);
}

export function isOverloadedError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return /503|overloaded|capacity/i.test(message);
}

// The Go subscription's dollar windows ran out ("Insufficient balance",
// "Monthly usage limit reached"...).
export function isBalanceError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return /insufficient balance|CreditsError|billing|usage limit|limit reached/i.test(message);
}

// Which quota window is actually exhausted, with its reset time.
export async function quotaResetInfo(): Promise<{
  window: "rolling" | "monthly";
  resetAt: string | null;
}> {
  const official = await getOpenCodeOfficialUsage();
  if (official?.monthly?.status === "rate-limited") {
    return { window: "monthly", resetAt: official.monthly.resetsAt ?? null };
  }
  return { window: "rolling", resetAt: official?.rolling?.resetsAt ?? null };
}

// User-facing error text, localized, with the quota reset time when known.
export async function chatErrorMessage(
  error: unknown,
  language?: "zh" | "en"
): Promise<string> {
  const raw = String(error instanceof Error ? error.message : error);
  if (isBalanceError(error)) {
    const { window, resetAt } = await quotaResetInfo();
    const resetsAt = resetAt ? new Date(resetAt).toLocaleString() : null;
    if (language === "en") {
      return (
        `OpenCode subscription ${window === "monthly" ? "monthly" : "5-hour"} usage is exhausted.` +
        (resetsAt ? ` It resets around ${resetsAt} — please retry later.` : " Please retry later.") +
        " Usage console: opencode.ai/auth"
      );
    }
    return (
      `OpenCode 订阅${window === "monthly" ? "月度" : "5 小时窗口"}额度已用完。` +
      (resetsAt ? `额度预计在 ${resetsAt} 重置，请稍后再试。` : "请稍后再试。") +
      "用量详情：opencode.ai/auth"
    );
  }
  if (isQuotaError(error)) {
    return language === "en"
      ? "The AI service is busy right now — please retry in a moment."
      : "AI 服务当前繁忙，请稍后再试。";
  }
  if (isOverloadedError(error)) {
    return language === "en"
      ? "The model is overloaded right now — please retry."
      : "模型服务繁忙，请稍后重试。";
  }
  return raw;
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

interface OpenAiContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface ToolCallWire {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAiContentPart[];
  tool_calls?: ToolCallWire[];
  tool_call_id?: string;
}

function toOpenAiMessages(
  messages: ChatMessage[],
  timeZone?: string,
  language?: "zh" | "en",
  systemPrompt?: string
): OpenAiMessage[] {
  const out: OpenAiMessage[] = [
    { role: "system", content: systemPrompt ?? getSystemPrompt(timeZone, language) },
  ];
  for (const message of messages) {
    const role = message.role === "model" ? "assistant" : "user";
    if (message.images && message.images.length > 0) {
      const parts: OpenAiContentPart[] = [];
      if (message.text.trim()) {
        parts.push({ type: "text", text: message.text });
      }
      for (const image of message.images) {
        const mimeType = image.mimeType.toLowerCase();
        if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
          throw new ChatValidationError(
            `Unsupported image type: ${mimeType}. Allowed: JPEG, PNG, WebP.`
          );
        }
        const bytes = Math.floor((image.data.length * 3) / 4);
        if (bytes > MAX_IMAGE_BYTES) {
          throw new ChatValidationError("Image is too large. Max size is 5 MB.");
        }
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${image.mimeType};base64,${image.data}`,
          },
        });
      }
      out.push({ role, content: parts });
      continue;
    }
    if (!message.text.trim()) continue;
    out.push({ role, content: message.text });
  }
  return out;
}

const WEB_FETCH_TOOL = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "Fetch a web page and return its readable text (up to 8000 characters). Use it to check live information: current prices, documentation, news, anything you cannot answer reliably from memory. Provide the full https URL.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to fetch, e.g. https://api-docs.deepseek.com/quick_start/pricing",
        },
      },
      required: ["url"],
    },
  },
};

interface DeltaToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiChunk {
  choices?: {
    delta?: { content?: string | null; tool_calls?: DeltaToolCall[] };
    finish_reason?: string | null;
  }[];
  error?: { message?: string };
  cost?: number | string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

interface OpenAiCompletion {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string };
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

async function postCompletion(
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<Response> {
  return fetch(`${OPENCODE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenCodeKey()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function errorFromResponse(status: number, text: string): Error {
  let message = `OpenCode request failed (HTTP ${status}).`;
  try {
    const parsed = JSON.parse(text) as OpenAiChunk;
    if (parsed.error?.message) message = parsed.error.message;
  } catch {}
  return new Error(message);
}

// One streaming round: yields content tokens and returns accumulated tool
// calls (via the generator return value).
async function* streamOpenCodeOnce(
  messages: OpenAiMessage[],
  model: string,
  tools: boolean
): AsyncGenerator<string, { toolCalls: ToolCall[] }, void> {
  const requestId = Math.random().toString(36).slice(2, 8);
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    temperature: 0.7,
    reasoning_effort: "max",
  };
  if (tools) body.tools = [WEB_FETCH_TOOL];
  const startedAt = Date.now();
  console.log(
    `[opencode:${requestId}] start — model ${model}, ${messages.length} messages${tools ? ", tools on" : ""}`
  );

  if (process.env.OPENCODE_TEST_LIMIT === "1") {
    throw new Error(
      "Monthly usage limit reached. Resets in 20 days. (test-limit simulation)"
    );
  }

  const response = await postCompletion(model, body, 120_000);

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    const error = errorFromResponse(response.status, text);
    console.log(
      `[opencode:${requestId}] ${model} HTTP ${response.status} → ${text.slice(0, 200)}`
    );
    insertCall({
      kind: "opencode",
      model,
      ok: false,
      error: error.message.slice(0, 300),
    }).catch(() => {});
    throw error;
  }

  yield encodeModelMarker(model);
  console.log(`[opencode:${requestId}] connected ${model}, waiting for first token`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let produced = false;
  let firstTokenAt: number | null = null;
  let failed: Error | null = null;
  const toolAcc: Record<number, { id: string; name: string; args: string }> = {};
  let lastCost: number | undefined;
  let lastUsage: OpenAiChunk["usage"];

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
        if (typeof chunk.cost === "number") lastCost = chunk.cost;
        if (chunk.usage) lastUsage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta;
        for (const tc of delta?.tool_calls ?? []) {
          const tIdx = tc.index ?? 0;
          const acc = (toolAcc[tIdx] ??= { id: "", name: "", args: "" });
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
        }
        const text = delta?.content;
        if (text) {
          if (!produced) {
            produced = true;
            firstTokenAt = Date.now();
          }
          yield text;
        }
      }
    }
  } catch (error) {
    failed = error instanceof Error ? error : new Error(String(error));
  }

  const totalMs = Date.now() - startedAt;
  const toolCalls: ToolCall[] = Object.values(toolAcc).map((acc) => ({
    id: acc.id,
    name: acc.name,
    arguments: acc.args,
  }));

  if (failed) {
    insertCall({
      kind: "opencode",
      model,
      ok: false,
      error: failed.message.slice(0, 300),
    }).catch(() => {});
    console.log(
      `[opencode:${requestId}] stream error → ${failed.message.slice(0, 200)}`
    );
    throw failed;
  }
  if (!produced && toolCalls.length === 0) {
    const error = new Error("OpenCode stream ended with no content.");
    insertCall({
      kind: "opencode",
      model,
      ok: false,
      error: error.message,
    }).catch(() => {});
    throw error;
  }
  const ttfbMs = firstTokenAt ? firstTokenAt - startedAt : totalMs;
  const usage = lastUsage
    ? {
        input: lastUsage.prompt_tokens ?? 0,
        output: lastUsage.completion_tokens ?? 0,
        reasoning: lastUsage.completion_tokens_details?.reasoning_tokens ?? 0,
        cacheRead: lastUsage.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWrite: 0,
      }
    : undefined;
  insertCall({
    kind: "opencode",
    model,
    ok: true,
    cost: lastCost,
    tokens: usage,
  }).catch(() => {});
  console.log(
    `[opencode:${requestId}] done — ${model}: first token ${ttfbMs}ms, total ${totalMs}ms, ${toolCalls.length} tool calls`
  );
  return { toolCalls };
}

async function executeTool(
  requestId: string,
  call: ToolCall
): Promise<OpenAiMessage> {
  let text: string;
  if (call.name === "web_fetch") {
    let url: string | undefined;
    try {
      url = (JSON.parse(call.arguments) as { url?: unknown }).url as
        | string
        | undefined;
    } catch {}
    if (typeof url !== "string" || !url) {
      text = "web_fetch failed: missing url argument.";
    } else {
      const result = await fetchPageText(url);
      text = result.ok
        ? `Fetched ${result.url}:\n${result.text}`
        : `Fetch failed (${result.error}).`;
    }
  } else {
    text = `Unknown tool: ${call.name}`;
  }
  console.log(`[opencode:${requestId}] tool ${call.name} → ${text.slice(0, 120)}`);
  return {
    role: "tool",
    tool_call_id: call.id,
    content: text.slice(0, 9000),
  };
}

const MAX_TOOL_ROUNDS = 6;

// Chat with web_fetch tool use: images → vision model (no tools); text →
// pinned model or pro→flash chain, with an agent loop for tool calls.
export async function* streamChat(
  messages: ChatMessage[],
  timeZone?: string,
  language?: "zh" | "en",
  freeMode = false
): AsyncGenerator<string> {
  const hasImage = messages.some((message) => (message.images?.length ?? 0) > 0);
  const useTools = !hasImage;
  const requestId = Math.random().toString(36).slice(2, 8);
  let chain = getChatChain(hasImage);
  const systemOverride = freeMode
    ? getSystemPrompt(timeZone, language, true)
    : undefined;
  let working: OpenAiMessage[] = toOpenAiMessages(
    messages,
    timeZone,
    language,
    systemOverride
  );
  let lastError: unknown = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let roundDone = false;
    for (const model of chain) {
      for (let attempt = 0; attempt < 3; attempt++) {
        let toolCalls: ToolCall[] = [];
        try {
          yield encodeTryingMarker(model);
          const gen = streamOpenCodeOnce(working, model, useTools);
          while (true) {
            const { done, value } = await gen.next();
            if (done) {
              toolCalls = value?.toolCalls ?? [];
              break;
            }
            yield value as string;
          }
        } catch (error) {
          lastError = error;
          if (error instanceof ChatValidationError) throw error;
        if (isQuotaError(error) || isUnavailableError(error) || isBalanceError(error)) {
          console.log(`[opencode:${requestId}] ${model} unavailable → next model`);
          break;
        }
          if (isOverloadedError(error)) {
            const delay = 1500 * (attempt + 1);
            console.log(`[opencode:${requestId}] ${model} overloaded → retry in ${delay}ms`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw error;
        }

        if (toolCalls.length === 0) {
          return; // final answer already streamed
        }

        const toolMessages = await Promise.all(
          toolCalls.map((call) => executeTool(requestId, call))
        );
        working = [
          ...working,
          {
            role: "assistant",
            content: "",
            tool_calls: toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          },
          ...toolMessages,
        ];
        // Stick with the model that just answered for the next round.
        chain = [model, ...chain.filter((m) => m !== model)];
        roundDone = true;
        break;
      }
      if (roundDone) break;
    }
    if (!roundDone) {
      console.log(
        `[opencode:${requestId}] failed — all ${chain.length} models unavailable`
      );
      throw lastError ?? new Error("Chat request failed: all models unavailable.");
    }
  }

  throw new Error(
    `Research stopped after ${MAX_TOOL_ROUNDS} tool rounds — please narrow the question and try again.`
  );
}

// Non-streaming completion, used by Conclude and the health probe.
export async function completeOpenCode(
  model: string,
  messages: ChatMessage[],
  timeZone?: string,
  language?: "zh" | "en",
  options?: {
    maxTokens?: number;
    json?: boolean;
    systemPrompt?: string;
    reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "max";
  }
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAiMessages(messages, timeZone, language, options?.systemPrompt),
    stream: false,
    temperature: options?.json ? 0.1 : 0.7,
    reasoning_effort: options?.reasoning ?? "high",
  };
  if (options?.maxTokens) body.max_tokens = options.maxTokens;
  if (options?.json) body.response_format = { type: "json_object" };

  const response = await postCompletion(model, body, 60_000);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw errorFromResponse(response.status, text);
  }
  const data = (await response.json().catch(() => ({}))) as OpenAiCompletion;
  if (data.error?.message) throw new Error(data.error.message);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenCode returned an empty response.");
  return content;
}
