import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { getApiKey } from "./gemini";
import { CHAT_MODELS } from "./models";
import { recordRequest, recordQuotaCleared, recordQuotaExhausted } from "./usage";
import { insertCall } from "./db";

export type HealthStatus =
  | "ok"
  | "quota"
  | "busy"
  | "retired"
  | "empty"
  | "error";

export interface HealthResult {
  model: string;
  status: HealthStatus;
  ms: number;
  detail?: string;
}

export interface HealthReport {
  results: HealthResult[];
  cachedAt: number;
  stale: boolean;
}

const CHECK_PROMPT = "Reply with the single word: ok";
// Fast probe: thinking off (thinking models answer in <1s with it off);
// non-thinking models reject thinkingConfig with 400 -> adaptive fallback.
const TIMEOUT_MS = 20_000;

let cache: { at: number; results: HealthResult[] } | null = null;
let inflight: Promise<HealthResult[]> | null = null;

function classify(message: string, ms: number, model: string): HealthResult {
  if (/404|not found|retired|discontinued|does not exist/i.test(message)) {
    return { model, status: "retired", ms, detail: "404 unavailable" };
  }
  if (/RESOURCE_EXHAUSTED|429/.test(message)) {
    recordQuotaExhausted(model);
    return { model, status: "quota", ms, detail: "daily quota exhausted" };
  }
  if (message.includes("503")) {
    return { model, status: "busy", ms, detail: "503 capacity" };
  }
  if (/aborted|timeout/i.test(message)) {
    return { model, status: "busy", ms, detail: "slow (>20s)" };
  }
  return { model, status: "error", ms, detail: message.slice(0, 80) };
}

async function generateOnce(
  model: string,
  signal: AbortSignal,
  thinkingOff: boolean
): Promise<GenerateContentResponse> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const config = thinkingOff
    ? { maxOutputTokens: 16, thinkingConfig: { thinkingBudget: 0 } }
    : { maxOutputTokens: 16 };
  return ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: CHECK_PROMPT }] }],
    config: { ...config, abortSignal: signal },
  });
}

async function probe(model: string): Promise<HealthResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    let response: GenerateContentResponse;
    try {
      response = await generateOnce(model, controller.signal, true);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      const isBadArgument = message.includes("400") || message.includes("invalid argument");
      if (!isBadArgument) throw error;
      response = await generateOnce(model, controller.signal, false);
    }
    const ms = Date.now() - t0;
    recordRequest(model);
    recordQuotaCleared(model);
    insertCall({ kind: "health", model, ok: true }).catch(() => {});
    const text = (response.text || "").trim();
    if (!text) {
      return { model, status: "empty", ms, detail: "no text returned" };
    }
    return { model, status: "ok", ms };
  } catch (error) {
    const ms = Date.now() - t0;
    const message = String(error instanceof Error ? error.message : error);
    insertCall({ kind: "health", model, ok: false, error: message.slice(0, 300) }).catch(() => {});
    return classify(message, ms, model);
  } finally {
    clearTimeout(timer);
  }
}

export function checkAllModels(force = false): Promise<HealthResult[]> {
  if (inflight) {
    return inflight;
  }
  const active = CHAT_MODELS.filter((model) => !model.retired);
  inflight = Promise.all(active.map((model) => probe(model.name))).then(
    (results) => {
      cache = { at: Date.now(), results };
      inflight = null;
      return results;
    }
  );
  return inflight;
}

// Only an explicit force run sends probes (each probe costs 1 request on
// models that answer). Plain reads return the last cached results — or
// nothing — and never burn quota.
export async function getHealthReport(force = false): Promise<HealthReport> {
  if (!force) {
    if (cache) {
      return { results: cache.results, cachedAt: cache.at, stale: false };
    }
    return { results: [], cachedAt: 0, stale: false };
  }
  const results = await checkAllModels(true);
  return { results, cachedAt: cache?.at ?? Date.now(), stale: false };
}
