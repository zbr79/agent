import fs from "node:fs";
import path from "node:path";

export interface ModelInfo {
  name: string;
  label: string;
  tier: "lite" | "pro" | "omni";
  vision: "yes" | "unverified";
  retired?: boolean;
}

// Catalog of chat models returned by the models.list API on 2026-08-27,
// annotated with results of the image-support probe run that day:
// - vision "yes": returned a valid answer to a test image.
// - vision "unverified": blocked by daily quota (pro/omni) or intermittent
//   503 capacity at probe time — almost certainly multimodal, not confirmed.
// Retired models (404 at probe time: gemini-2.5-*, gemini-3.1-flash-live-preview,
// gemini-3.5-live-translate-preview) were removed from the catalog on 2026-08-28.
// The health probe still classifies any live 404 as "retired" so the UI hides
// newly retired models automatically.
export const CHAT_MODELS: ModelInfo[] = [
  { name: "gemini-3.6-flash", label: "Gemini 3.6 Flash", tier: "lite", vision: "yes" },
  { name: "gemini-3.5-flash", label: "Gemini 3.5 Flash", tier: "lite", vision: "unverified" },
  { name: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", tier: "lite", vision: "yes" },
  { name: "gemini-3.7-flash", label: "Gemini 3.7 Flash", tier: "lite", vision: "unverified" },
  { name: "gemini-flash-latest", label: "Gemini Flash (latest)", tier: "lite", vision: "unverified" },
  { name: "gemini-flash-lite-latest", label: "Gemini Flash Lite (latest)", tier: "lite", vision: "yes" },
  { name: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", tier: "lite", vision: "yes" },
  { name: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", tier: "lite", vision: "yes" },
  { name: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite Preview", tier: "lite", vision: "yes" },
  { name: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", tier: "pro", vision: "unverified" },
  { name: "gemini-3.1-pro-preview-customtools", label: "Gemini 3.1 Pro Preview (customtools)", tier: "pro", vision: "unverified" },
  { name: "gemini-pro-latest", label: "Gemini Pro (latest)", tier: "pro", vision: "unverified" },
  { name: "gemini-omni-flash-preview", label: "Gemini Omni Flash Preview", tier: "omni", vision: "unverified" },
  { name: "gemini-omni-1.1-flash", label: "Gemini Omni 1.1 Flash", tier: "omni", vision: "unverified" },
];

export function findModel(name: string): ModelInfo | undefined {
  return CHAT_MODELS.find((model) => model.name === name);
}

const DATA_DIR = path.join(process.cwd(), "data");
const MODEL_FILE = path.join(DATA_DIR, "model.json");

export const AUTO_MODEL = "auto";

// Chat chain: best tier first, falling back one tier at a time.
// Pro/omni lead (they are paid-only, so on the free tier they fail fast
// with a free 429 and the chain lands on the first usable flash/lite).
const CHAT_CHAIN: string[] = [
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro-preview-customtools",
  "gemini-pro-latest",
  "gemini-omni-flash-preview",
  "gemini-omni-1.1-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.7-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
];

// Conclude chain: lowest tier first, moving up only when one is exhausted
// (Conclude is pure text — lite models are enough).
const CONCLUDE_CHAIN: string[] = [
  "gemini-flash-lite-latest",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-flash-latest",
  "gemini-omni-flash-preview",
  "gemini-omni-1.1-flash",
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro-preview-customtools",
  "gemini-pro-latest",
];

function filterChain(chain: string[]): string[] {
  return chain.filter((name) => findModel(name));
}

export function defaultModel(): string {
  return AUTO_MODEL;
}

export function getActiveModel(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(MODEL_FILE, "utf8")) as {
      model?: unknown;
    };
    if (raw && typeof raw.model === "string") {
      if (raw.model === AUTO_MODEL) return AUTO_MODEL;
      if (findModel(raw.model)) return raw.model;
    }
  } catch {}
  return defaultModel();
}

export function setActiveModel(model: string): void {
  if (model !== AUTO_MODEL) {
    const info = findModel(model);
    if (!info || info.retired) {
      throw new Error(`Unknown or unavailable model: ${model}`);
    }
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MODEL_FILE, JSON.stringify({ model }));
}

// Chat: in auto mode use the whole best→lowest chain; a manually pinned
// model runs alone (no fallback).
export function getChatChain(): string[] {
  const selected = getActiveModel();
  if (selected === AUTO_MODEL) return filterChain(CHAT_CHAIN);
  return [selected];
}

// Conclude: lowest tier first; CONCLUDE_MODEL (if valid) jumps the queue.
export function getConcludeChain(): string[] {
  const chain = filterChain(CONCLUDE_CHAIN);
  const preferred = process.env.CONCLUDE_MODEL;
  if (preferred && findModel(preferred) && preferred !== chain[0]) {
    return [preferred, ...chain.filter((name) => name !== preferred)];
  }
  return chain;
}
