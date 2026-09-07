import fs from "node:fs";
import path from "node:path";
import { AGENT_ROOT, assertAllowedAgentFile } from "./pathJail";

// The persona lives in SYSTEM_PROMPT.md (project root) so it can be edited
// without touching code; re-read per request so edits apply without a restart.
const PROMPT_FILE = assertAllowedAgentFile(path.join(AGENT_ROOT, "SYSTEM_PROMPT.md"));
const FALLBACK_PROMPT =
  "You are InsChat, a friendly and concise assistant. Answer clearly, use plain language, and format longer answers with markdown.";

// Used by the local opencode serve path (file tools under AGENT_ROOT).
const AGENT_WORKSPACE_TOOLS =
  "Workspace tools (local opencode agent): you can read, edit, list, glob, and grep files inside /home/ubuntu/agent, plus webfetch/websearch. bash and paths outside that workspace are denied; .env/.server-env and private keys are denied. When the user asks about project files, use the file tools — do not claim you only have web_fetch or cannot read/write files. Prefer tools over guessing file contents.";

const FREE_PROMPT =
  "You are InsChat, a helpful and friendly general assistant. Answer the user's questions clearly and directly, matching the depth of the question; use markdown (headings, tables, lists) when it helps readability. Reply in the language the user writes in; if their message has no language cues, use the UI language mode stated below. You have a web_fetch tool: when the user asks for live data (prices, news, current docs) or anything you can't verify from memory, call web_fetch on the relevant page and answer from what it returns — never claim you can't access the internet. Never invent numbers or facts; only when even web_fetch can't find the answer, say so.";

const FREE_AGENT_PROMPT =
  "You are InsChat OpenCode, a helpful coding assistant for the /home/ubuntu/agent workspace. Answer clearly; use markdown when it helps. Reply in the language the user writes in; if their message has no language cues, use the UI language mode stated below. " +
  AGENT_WORKSPACE_TOOLS +
  " Never invent file contents — read them. Never invent numbers or facts; use webfetch when live data is needed.";

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function currentTimeLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(new Date());
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}年${get("month")}月${get("day")}日 ${get("dayPeriod")} ${get("hour")}:${get("minute")}`;
  } catch {
    return new Date().toISOString();
  }
}

export function getSystemPrompt(
  timeZone?: string,
  language?: "zh" | "en",
  freeMode = false,
  agentTools = false
): string {
  const zone =
    timeZone && isValidTimeZone(timeZone)
      ? timeZone
      : process.env.RECORD_TIMEZONE || "Asia/Shanghai";
  if (freeMode) {
    const modeLine =
      language === "en"
        ? "\n\nUI language mode: English — use English only when the user's message has no language cues (photo alone, bare number)."
        : "\n\nUI语言模式：中文 — 仅在用户消息没有语言线索（纯图片、纯数字）时使用中文。";
    const base = agentTools ? FREE_AGENT_PROMPT : FREE_PROMPT;
    return `${base}${modeLine}`;
  }
  try {
    const prompt = fs.readFileSync(PROMPT_FILE, "utf8").trim();
    if (prompt) {
      const modeLine =
        language === "en"
          ? "\n\nUI language mode: English — use English only when the user's message has no language cues (photo alone, bare number)."
          : "\n\nUI语言模式：中文 — 仅在用户消息没有语言线索（纯图片、纯数字）时使用中文。";
      const toolsLine = agentTools ? `\n\n${AGENT_WORKSPACE_TOOLS}` : "";
      return `${prompt}${modeLine}${toolsLine}\n\n当前时间（${zone}）: ${currentTimeLabel(zone)}`;
    }
  } catch {}
  return FALLBACK_PROMPT;
}
