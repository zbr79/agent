import fs from "node:fs";
import path from "node:path";
import { CHAT_MODELS, getActiveModel } from "./models";

// Free-tier limits, per model. Daily cap confirmed by the API's own 429
// quota payload:
//   GenerateRequestsPerDayPerProjectPerModel-FreeTier, quotaValue: "20"
// (the old "1500/day" was an unverified v1 assumption, since removed).
export const GEMINI_LIMITS = {
  rpm: 10,
  rpd: 20,
};

export function usableModelCount(): number {
  return CHAT_MODELS.filter((model) => !model.retired).length;
}

const DATA_DIR = path.join(process.cwd(), "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");

interface UsageState {
  dayKey: string;
  requests: number;
  errors: number;
  minuteTimes: number[];
  models: Record<string, number>;
  exhausted: Record<string, number>;
}

function pacificDayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function nextPacificMidnight(): string {
  const now = new Date();
  const ptNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const ptNext = new Date(ptNow.getFullYear(), ptNow.getMonth(), ptNow.getDate() + 1);
  const reset = new Date(ptNext.getTime() - (ptNow.getTime() - now.getTime()));
  return reset.toISOString();
}

function freshState(minuteTimes: number[] = []): UsageState {
  return { dayKey: pacificDayKey(), requests: 0, errors: 0, minuteTimes, models: {}, exhausted: {} };
}

function load(): UsageState {
  try {
    const raw = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as UsageState;
    if (raw && raw.dayKey === pacificDayKey()) {
      return {
        ...freshState(raw.minuteTimes ?? []),
        requests: raw.requests ?? 0,
        errors: raw.errors ?? 0,
        models: raw.models ?? {},
        exhausted: raw.exhausted ?? {},
      };
    }
  } catch {}
  return freshState();
}

let state: UsageState = load();

function rolloverIfNeeded() {
  if (state.dayKey !== pacificDayKey()) {
    state = freshState(state.minuteTimes);
  }
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(state));
  } catch {}
}

export function recordRequest(model?: string) {
  rolloverIfNeeded();
  const now = Date.now();
  state.requests += 1;
  if (model) {
    state.models[model] = (state.models[model] ?? 0) + 1;
  }
  state.minuteTimes = state.minuteTimes.filter((time) => now - time < 60_000);
  state.minuteTimes.push(now);
  persist();
}

export function recordError() {
  rolloverIfNeeded();
  state.errors += 1;
  persist();
}

export function recordQuotaExhausted(model: string) {
  rolloverIfNeeded();
  state.exhausted[model] = Date.now();
  persist();
}

export function recordQuotaCleared(model: string) {
  rolloverIfNeeded();
  if (state.exhausted[model]) {
    delete state.exhausted[model];
    persist();
  }
}

export function getModelUsage(model: string): number {
  rolloverIfNeeded();
  return state.models[model] ?? 0;
}

export function getModelExhaustedAt(model: string): number | null {
  rolloverIfNeeded();
  return state.exhausted[model] ?? null;
}

export function getUsage() {
  rolloverIfNeeded();
  const now = Date.now();
  state.minuteTimes = state.minuteTimes.filter((time) => now - time < 60_000);
  return {
    model: getActiveModel() === "auto" ? "auto (fallback chain)" : getActiveModel(),
    day: {
      used: state.requests,
      limit: usableModelCount() * GEMINI_LIMITS.rpd,
      resetAt: nextPacificMidnight(),
    },
    minute: {
      used: state.minuteTimes.length,
      limit: GEMINI_LIMITS.rpm,
    },
    errors: state.errors,
    models: CHAT_MODELS.map((model) => ({
      name: model.name,
      label: model.label,
      tier: model.tier,
      vision: model.vision,
      retired: !!model.retired,
      used: state.models[model.name] ?? 0,
      exhaustedAt: state.exhausted[model.name] ?? null,
    })),
  };
}
