import fs from "node:fs";
import path from "node:path";
import { AGENT_ROOT, assertAllowedAgentFile } from "./pathJail";

export interface ModelInfo {
  name: string;
  label: string;
  tier: "pro" | "flash";
  vision: boolean;
  retired?: boolean;
}

// opencode-go catalog: models reachable through the OpenAI-compatible
// /chat/completions endpoint of https://opencode.ai/zen/go/v1.
// Vision flags come from vendor documentation research (2026-08-29):
// only models with documented image input are marked vision: true.
// Models served only via /responses (grok-*, muse-spark-1.2-contributor)
// or /messages (minimax-*, qwen3.8-*) are excluded from this catalog.
export const CHAT_MODELS: ModelInfo[] = [
  { name: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tier: "pro", vision: false, retired: true },
  { name: "deepseek-v4-flash", label: "DeepSeek V4 Flash", tier: "flash", vision: false },
  { name: "gpt-6-luna", label: "GPT-6 Luna", tier: "pro", vision: true },
  { name: "qwen3.8-flash", label: "Qwen3.8 Flash", tier: "flash", vision: true },
  { name: "deepseek-v4-flash-free", label: "DeepSeek V4 Flash (Free)", tier: "flash", vision: false },
  { name: "mimo-v2.5-free", label: "MiMo-V2.5 (Free)", tier: "flash", vision: false },
  { name: "big-pickle", label: "Big Pickle (Free)", tier: "flash", vision: false },
  { name: "nemotron-3-ultra-free", label: "Nemotron 3 Ultra (Free)", tier: "flash", vision: false },
  { name: "nemotron-3.5-lightning-free", label: "Nemotron 3.5 Lightning (Free)", tier: "flash", vision: false },
  { name: "ling-3.0-flash-fin-free", label: "Ling 3.0 Flash (Free)", tier: "flash", vision: false },
  { name: "laguna-s-2.1-free", label: "Laguna S 2.1 (Free)", tier: "flash", vision: false },
  { name: "glm-5.3", label: "GLM-5.3", tier: "pro", vision: false },
  { name: "glm-5.3-flash", label: "GLM-5.3 Flash", tier: "flash", vision: true },
  { name: "glm-5.2", label: "GLM-5.2", tier: "pro", vision: false },
  { name: "glm-5.1", label: "GLM-5.1", tier: "pro", vision: false },
  { name: "glm-5", label: "GLM-5", tier: "pro", vision: false },
  { name: "kimi-k3", label: "Kimi K3", tier: "pro", vision: true },
  { name: "kimi-k2.7-code", label: "Kimi K2.7 Code", tier: "pro", vision: true },
  { name: "kimi-k2.6", label: "Kimi K2.6", tier: "pro", vision: true },
  { name: "kimi-k2.5", label: "Kimi K2.5", tier: "pro", vision: true },
  { name: "longcat-2.0", label: "LongCat-2.0", tier: "flash", vision: false },
  { name: "mimo-v2.5-pro", label: "MiMo-V2.5-Pro", tier: "pro", vision: true },
  { name: "mimo-v2.5", label: "MiMo-V2.5", tier: "flash", vision: true },
  { name: "mimo-v2-omni", label: "MiMo-V2-Omni", tier: "pro", vision: true },
  { name: "mimo-v2-pro", label: "MiMo-V2-Pro", tier: "pro", vision: false },
  { name: "qwen3.7-max", label: "Qwen3.7 Max", tier: "pro", vision: true },
  { name: "qwen3.7-plus", label: "Qwen3.7 Plus", tier: "pro", vision: true },
  { name: "qwen3.6-plus", label: "Qwen3.6 Plus", tier: "pro", vision: true },
  { name: "hy4-preview", label: "Hy4 Preview", tier: "pro", vision: false },
  { name: "hy3", label: "Hy3", tier: "flash", vision: false },
  { name: "hy3-preview", label: "Hy3 Preview", tier: "flash", vision: false },
];

export function findModel(name: string): ModelInfo | undefined {
  return CHAT_MODELS.find((model) => model.name === name);
}

const DATA_DIR = assertAllowedAgentFile(path.join(AGENT_ROOT, "data"));
const MODEL_FILE = assertAllowedAgentFile(path.join(DATA_DIR, "model.json"));

export const AUTO_MODEL = "auto";

// GPT-6 Luna is the default paid model. GLM-5.3 Flash is the only fallback
// for both text and image requests, matching InsChat's service policy.
export const PRIMARY_MODEL = "gpt-6-luna";
const TEXT_CHAIN_FULL: string[] = [
  PRIMARY_MODEL,
  "glm-5.3-flash",
];
export const IMAGE_CHAIN: string[] = [PRIMARY_MODEL, "glm-5.3-flash"];

// DeepSeek peak hours per official docs: 01:00-04:00 and 06:00-10:00 UTC,
// Monday through Friday (= 09:00-12:00 and 14:00-18:00 Beijing, UTC+8).
export function isDeepSeekPeak(now: Date = new Date()): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (mins >= 60 && mins < 240) || (mins >= 360 && mins < 600);
}

// The bound opencode agent thread uses GPT-6 Luna by default. An explicit
// AGENT_DEFAULT_MODEL still wins when set.
export function agentModelId(): string {
  const override = process.env.AGENT_DEFAULT_MODEL?.trim();
  if (override) return override;
  return PRIMARY_MODEL;
}

// Effective model for the bound opencode agent. A UI-pinned model wins.
export type TextModelPin =
  | "gpt-6-luna"
  | "deepseek-v4-flash"
  | "qwen3.8-flash"
  | "glm-5.3-flash";

export function resolveAgentModel(pinned?: TextModelPin): string {
  if (pinned) return pinned;
  return agentModelId();
}

// The Go gateway is billed per token and GLM-5.3-Flash is flat-priced, so the
// image chain no longer needs peak-hours branching.

function textChain(): string[] {
  return TEXT_CHAIN_FULL;
}

function filterChain(chain: string[]): string[] {
  return chain.filter((name) => findModel(name) && !findModel(name)?.retired);
}

export function defaultModel(): string {
  return PRIMARY_MODEL;
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

// Images always route to the vision chain; a manually pinned model applies
// to text-only requests. The Luna default uses the same paid fallback chain.
export function getChatChain(hasImage: boolean): string[] {
  if (hasImage) return filterChain(IMAGE_CHAIN);
  const selected = getActiveModel();
  if (selected === AUTO_MODEL) return filterChain(textChain());
  return selected === PRIMARY_MODEL
    ? filterChain(TEXT_CHAIN_FULL)
    : [selected];
}
