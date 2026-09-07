// Free-chat system prompts only. The insulin (preset) persona file
// SYSTEM_PROMPT.md and its template branch were removed — see
// PLAN_REMOVE_INSULIN_MODE.md.

// Used by the local opencode serve path (file tools under AGENT_ROOT).
const AGENT_WORKSPACE_TOOLS =
  "Workspace tools (local opencode agent): you can read, edit, list, glob, and grep files inside /home/ubuntu/agent, plus webfetch/websearch. bash and paths outside that workspace are denied; .env/.server-env and private keys are denied. When the user asks about project files, use the file tools — do not claim you only have web_fetch or cannot read/write files. Prefer tools over guessing file contents.";

const FREE_PROMPT =
  "You are Agent, a helpful and friendly general assistant. Answer the user's questions clearly and directly, matching the depth of the question; use markdown (headings, tables, lists) when it helps readability. Reply in the language the user writes in; if their message has no language cues, use the UI language mode stated below. You have a web_fetch tool: when the user asks for live data (prices, news, current docs) or anything you can't verify from memory, call web_fetch on the relevant page and answer from what it returns — never claim you can't access the internet. Never invent numbers or facts; only when even web_fetch can't find the answer, say so.";

const FREE_AGENT_PROMPT =
  "You are Agent OpenCode, a helpful coding assistant for the /home/ubuntu/agent workspace. Answer clearly; use markdown when it helps. Reply in the language the user writes in; if their message has no language cues, use the UI language mode stated below. " +
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

export function getSystemPrompt(
  language?: "zh" | "en",
  agentTools = false
): string {
  const modeLine =
    language === "en"
      ? "\n\nUI language mode: English — use English only when the user's message has no language cues (photo alone, bare number)."
      : "\n\nUI语言模式：中文 — 仅在用户消息没有语言线索（纯图片、纯数字）时使用中文。";
  const base = agentTools ? FREE_AGENT_PROMPT : FREE_PROMPT;
  return `${base}${modeLine}`;
}
