import type { ChatMessage } from "./types";

// Keep ordinary conversation fast. Luna's high-effort reasoning is reserved
// for prompts that are likely to benefit from deliberate analysis.
export type ChatReasoning = "none" | "max";

const COMPLEX_PROMPT_PATTERN =
  /\b(analy[sz]e|compare|contrast|trade[- ]?off|research|source|cite|latest|current|today|price|limit|model|api|code|debug|plan|design|step[- ]by[- ]step|explain|why|how)\b/i;

export function chooseChatReasoning(
  messages: ChatMessage[],
  mode: "plan" | "build",
  hasImage: boolean
): ChatReasoning {
  if (hasImage) return "none";
  if (mode === "build") return "max";

  const latestUserText =
    [...messages].reverse().find((message) => message.role === "user")?.text.trim() ?? "";
  const totalTextLength = messages.reduce((sum, message) => sum + message.text.length, 0);
  const hasDocuments = messages.some((message) => (message.documents?.length ?? 0) > 0);
  const isComplex =
    hasDocuments ||
    messages.length > 6 ||
    latestUserText.length > 220 ||
    totalTextLength > 6_000 ||
    COMPLEX_PROMPT_PATTERN.test(latestUserText);

  return isComplex ? "max" : "none";
}
