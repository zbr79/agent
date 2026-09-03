import fs from "node:fs";
import path from "node:path";

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
// Models served only via /responses (grok-*, gpt-5.6-luna,
// muse-spark-1.2-contributor) or /messages (minimax-*, qwen3.8-*)
// are excluded from this catalog.
export const CHAT_MODELS: ModelInfo[] = [
  { name: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tier: "pro", vision: false, retired: true },
  { name: "deepseek-v4-flash", label: "DeepSeek V4 Flash", tier: "flash", vision: false },
  { name: "qwen3.8-flash", label: "Qwen3.8 Flash", tier: "flash", vision: false },
  { name: "deepseek-v4-flash-free", label: "DeepSeek V4 Flash (Free)", tier: "flash", vision: false },
  { name: "mimo-v2.5-free", label: "MiMo-V2.5 (Free)", tier: "flash", vision: false },
  { name: "big-pickle", label: "Big Pickle (Free)", tier: "flash", vision: false },
  { name: "nemotron-3-ultra-free", label: "Nemotron 3 Ultra (Free)", tier: "flash", vision: false },
  { name: "nemotron-3.5-lightning-free", label: "Nemotron 3.5 Lightning (Free)", tier: "flash", vision: false },
  { name: "ling-3.0-flash-fin-free", label: "Ling 3.0 Flash (Free)", tier: "flash", vision: false },
  { name: "laguna-s-2.1-free", label: "Laguna S 2.1 (Free)", tier: "flash", vision: false },
  { name: "deepseek-v4-flash-vision-exp", label: "DeepSeek V4 Flash Vision Exp", tier: "flash", vision: true },
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
  { name: "qwen3.5-plus", label: "Qwen3.5 Plus", tier: "pro", vision: true },
  { name: "hy4-preview", label: "Hy4 Preview", tier: "pro", vision: false },
  { name: "hy3", label: "Hy3", tier: "flash", vision: false },
  { name: "hy3-preview", label: "Hy3 Preview", tier: "flash", vision: false },
];

export function findModel(name: string): ModelInfo | undefined {
  return CHAT_MODELS.find((model) => model.name === name);
}

const DATA_DIR = path.join(process.cwd(), "data");
const MODEL_FILE = path.join(DATA_DIR, "model.json");

export const AUTO_MODEL = "auto";

// Chat chains (opencode-go). Text: qwen3.8-flash is the primary (flat
// pricing, cheaper than DeepSeek at every hour, fastest on the gateway);
// deepseek-v4-flash is used only OFF-PEAK as a fallback because DeepSeek's
// peak prices double it (Mon-Fri 01:00-04:00 & 06:00-10:00 UTC). Images
// always go to the Go gateway's only officially image-billed model.
const TEXT_CHAIN_FULL: string[] = [
  "qwen3.8-flash",
  "deepseek-v4-flash",
  "deepseek-v4-flash-free",
  "mimo-v2.5-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "ling-3.0-flash-fin-free",
  "laguna-s-2.1-free",
  "big-pickle",
];
export const IMAGE_CHAIN: string[] = [
  "deepseek-v4-flash-vision-exp",
  "qwen3.5-plus",
];

// Conclude chain: cheapest reliable text model first, then the free models.
const CONCLUDE_CHAIN_FULL: string[] = [
  "qwen3.8-flash",
  "deepseek-v4-flash",
  "deepseek-v4-flash-free",
  "mimo-v2.5-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "ling-3.0-flash-fin-free",
  "laguna-s-2.1-free",
  "big-pickle",
];

// DeepSeek peak hours per official docs: 01:00-04:00 and 06:00-10:00 UTC,
// Monday through Friday (= 09:00-12:00 and 14:00-18:00 Beijing, UTC+8).
function isDeepSeekPeak(now: Date = new Date()): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (mins >= 60 && mins < 240) || (mins >= 360 && mins < 600);
}

// Vision chain is time-aware too: qwen3.5-plus is flat $0.20/$1.20 —
// slightly cheaper than vision-exp's PEAK price ($0.44/$1.32) — so it goes
// first during peak; off-peak vision-exp (only $0.66 output) goes first.
function visionChain(): string[] {
  return isDeepSeekPeak()
    ? ["qwen3.5-plus", "deepseek-v4-flash-vision-exp"]
    : ["deepseek-v4-flash-vision-exp", "qwen3.5-plus"];
}

// During peak hours deepseek-v4-flash costs 2x (output $1.32 vs $0.47 for
// qwen3.8-flash) — drop it from the chain; keep it off-peak where it is
// cheaper than most alternatives.
function textChain(): string[] {
  return isDeepSeekPeak()
    ? TEXT_CHAIN_FULL.filter((name) => name !== "deepseek-v4-flash")
    : TEXT_CHAIN_FULL;
}

function concludeChain(): string[] {
  return isDeepSeekPeak()
    ? CONCLUDE_CHAIN_FULL.filter((name) => name !== "deepseek-v4-flash")
    : CONCLUDE_CHAIN_FULL;
}

function filterChain(chain: string[]): string[] {
  return chain.filter((name) => findModel(name) && !findModel(name)?.retired);
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

// Images always route to the vision chain; a manually pinned model applies
// to text-only requests. In auto mode, text uses the time-aware chain.
export function getChatChain(hasImage: boolean): string[] {
  if (hasImage) return filterChain(visionChain());
  const selected = getActiveModel();
  if (selected === AUTO_MODEL) return filterChain(textChain());
  return [selected];
}

export function getConcludeChain(): string[] {
  const chain = filterChain(concludeChain());
  const preferred = process.env.CONCLUDE_MODEL;
  if (preferred && findModel(preferred) && preferred !== chain[0]) {
    return [preferred, ...chain.filter((name) => name !== preferred)];
  }
  return chain;
}
