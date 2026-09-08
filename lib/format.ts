// Client-safe helpers for the usage-limit banner.

export type LimitWindow = "rolling" | "weekly" | "monthly";

export function parseLimitPayload(
  value: string
): { window: LimitWindow; resetAt: number } | null {
  const [window, resetAtRaw] = value.split("|");
  if (
    window !== "rolling" &&
    window !== "weekly" &&
    window !== "monthly"
  ) {
    return null;
  }
  const resetAt = Date.parse(resetAtRaw ?? "");
  if (Number.isNaN(resetAt)) return null;
  return { window, resetAt };
}

// Wall-clock duration of a finished reply, e.g. "1m 22s" / "22s" (en) or
// "1分22秒" / "22秒" (zh). Whole seconds only — no decimals.
export function formatElapsed(seconds: number, lang: "zh" | "en" = "en"): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (lang === "zh") {
    return m > 0 ? `${m}分${s}秒` : `${s}秒`;
  }
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// The agent protocol ends replies with a bare "DONE" line (older builds also
// synthesized a "Done" header, sometimes followed by summary bullets). The UI
// hides the word and shows a gray end-rule instead, so drop any standalone
// done line outside code fences from display text.
export function stripDoneLines(text: string): string {
  if (!text.trim()) return text;
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence && /^done[.!]?$/i.test(line.trim())) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\s+$/, "");
}

export function formatLimitReset(
  timestamp: number,
  lang: "zh" | "en"
): string {
  const date = new Date(timestamp);
  const now = new Date();
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (date.toDateString() === now.toDateString()) {
    return time;
  }
  if (lang === "zh") {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  return `${date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })} ${time}`;
}
