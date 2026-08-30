import { completeOpenCode, isOverloadedError, isQuotaError, isUnavailableError } from "./opencode";
import { CHAT_MODELS } from "./models";
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
const TIMEOUT_MS = 20_000;

let cache: { at: number; results: HealthResult[] } | null = null;
let inflight: Promise<HealthResult[]> | null = null;

function classify(message: string, ms: number, model: string): HealthResult {
  if (/not supported|does not exist|ModelError/i.test(message)) {
    return { model, status: "retired", ms, detail: "not on the Go plan" };
  }
  if (isQuotaError({ message })) {
    return { model, status: "quota", ms, detail: "subscription limit reached" };
  }
  if (isOverloadedError({ message })) {
    return { model, status: "busy", ms, detail: "503 capacity" };
  }
  if (/aborted|timeout/i.test(message)) {
    return { model, status: "busy", ms, detail: "slow (>20s)" };
  }
  return { model, status: "error", ms, detail: message.slice(0, 80) };
}

async function probe(model: string): Promise<HealthResult> {
  const t0 = Date.now();
  try {
    const text = (
      await completeOpenCode(
        model,
        [{ role: "user", text: CHECK_PROMPT }],
        undefined,
        undefined,
        { maxTokens: 16, reasoning: "none" }
      )
    ).trim();
    const ms = Date.now() - t0;
    insertCall({ kind: "health", model, ok: true }).catch(() => {});
    if (!text) {
      return { model, status: "empty", ms, detail: "no text returned" };
    }
    return { model, status: "ok", ms };
  } catch (error) {
    const ms = Date.now() - t0;
    const message = String(error instanceof Error ? error.message : error);
    insertCall({ kind: "health", model, ok: false, error: message.slice(0, 300) }).catch(() => {});
    return classify(message, ms, model);
  }
}

export function checkAllModels(): Promise<HealthResult[]> {
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

// Only an explicit force run sends probes (each probe costs a tiny request
// on models that answer). Plain reads return the last cached results.
export async function getHealthReport(force = false): Promise<HealthReport> {
  if (!force) {
    if (cache) {
      return { results: cache.results, cachedAt: cache.at, stale: false };
    }
    return { results: [], cachedAt: 0, stale: false };
  }
  const results = await checkAllModels();
  return { results, cachedAt: cache?.at ?? Date.now(), stale: false };
}
