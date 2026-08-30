import fs from "node:fs";
import path from "node:path";

// The persona lives in SYSTEM_PROMPT.md (project root) so it can be edited
// without touching code; re-read per request so edits apply without a restart.
const PROMPT_FILE = path.join(process.cwd(), "SYSTEM_PROMPT.md");
const FALLBACK_PROMPT =
  "You are InsChat, a friendly and concise assistant. Answer clearly, use plain language, and format longer answers with markdown.";

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

export function getSystemPrompt(timeZone?: string, language?: "zh" | "en"): string {
  const zone =
    timeZone && isValidTimeZone(timeZone)
      ? timeZone
      : process.env.RECORD_TIMEZONE || "Asia/Shanghai";
  try {
    const prompt = fs.readFileSync(PROMPT_FILE, "utf8").trim();
    if (prompt) {
      const modeLine =
        language === "en"
          ? "\n\nUI language mode: English — use English only when the user's message has no language cues (photo alone, bare number)."
          : "\n\nUI语言模式：中文 — 仅在用户消息没有语言线索（纯图片、纯数字）时使用中文。";
      return `${prompt}${modeLine}\n\n当前时间（${zone}）: ${currentTimeLabel(zone)}`;
    }
  } catch {}
  return FALLBACK_PROMPT;
}
