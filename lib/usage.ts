import fs from "node:fs";
import path from "node:path";

export const GEMINI_LIMITS = {
  rpm: 10,
  rpd: 1500,
};

const DATA_DIR = path.join(process.cwd(), "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");

interface UsageState {
  dayKey: string;
  requests: number;
  errors: number;
  minuteTimes: number[];
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

function load(): UsageState {
  try {
    const raw = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as UsageState;
    if (raw && raw.dayKey === pacificDayKey()) return raw;
  } catch {}
  return { dayKey: pacificDayKey(), requests: 0, errors: 0, minuteTimes: [] };
}

let state: UsageState = load();

function rolloverIfNeeded() {
  if (state.dayKey !== pacificDayKey()) {
    state = { dayKey: pacificDayKey(), requests: 0, errors: 0, minuteTimes: state.minuteTimes };
  }
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(state));
  } catch {}
}

export function recordRequest() {
  rolloverIfNeeded();
  const now = Date.now();
  state.requests += 1;
  state.minuteTimes = state.minuteTimes.filter((time) => now - time < 60_000);
  state.minuteTimes.push(now);
  persist();
}

export function recordError() {
  rolloverIfNeeded();
  state.errors += 1;
  persist();
}

export function getUsage() {
  rolloverIfNeeded();
  const now = Date.now();
  state.minuteTimes = state.minuteTimes.filter((time) => now - time < 60_000);
  return {
    model: process.env.GEMINI_MODEL || "gemini-flash-latest",
    day: {
      used: state.requests,
      limit: GEMINI_LIMITS.rpd,
      resetAt: nextPacificMidnight(),
    },
    minute: {
      used: state.minuteTimes.length,
      limit: GEMINI_LIMITS.rpm,
    },
    errors: state.errors,
  };
}
