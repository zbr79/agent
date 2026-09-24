/** Map streamed TRYING marker values (tools or model ids) to short UI labels. */
import type { UiLang } from "./i18n";

const TOOL_LABELS: Record<string, { en: string; zh: string }> = {
  read: { en: "Reading…", zh: "读取中…" },
  write: { en: "Writing…", zh: "写入中…" },
  edit: { en: "Editing…", zh: "编辑中…" },
  bash: { en: "Running…", zh: "执行中…" },
  shell: { en: "Running…", zh: "执行中…" },
  grep: { en: "Searching…", zh: "搜索中…" },
  glob: { en: "Finding…", zh: "查找中…" },
  list: { en: "Listing…", zh: "列出中…" },
  webfetch: { en: "Fetching…", zh: "获取中…" },
  fetch: { en: "Fetching…", zh: "获取中…" },
  task: { en: "Working…", zh: "处理中…" },
  tool: { en: "Working…", zh: "处理中…" },
};

function normalizeToolKey(raw: string): string {
  const base = raw.trim().toLowerCase().split(/[\s:/]/)[0] ?? "";
  return base.replace(/[^a-z0-9_-]/g, "");
}

/** Humanize a TRYING marker for a chip / status line. */
export function processStepLabel(raw: string, lang: UiLang): string {
  const key = normalizeToolKey(raw);
  const mapped = TOOL_LABELS[key];
  if (mapped) return lang === "zh" ? mapped.zh : mapped.en;
  const trimmed = raw.trim();
  if (!trimmed) return lang === "zh" ? "处理中…" : "Working…";
  const short = trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
  if (/^[a-z0-9._-]+$/i.test(trimmed) && trimmed.includes("-")) {
    return lang === "zh" ? `尝试 ${short}…` : `Trying ${short}…`;
  }
  return /[….]$/.test(short) ? short : `${short}…`;
}
