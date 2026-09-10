import { completeOpenCode } from "@/lib/opencode";
import { getChatChain } from "@/lib/models";

export const runtime = "nodejs";

const MAX_INPUT = 2000;
const MAX_TITLE = 40;

function cleanTitle(raw: string): string {
  const line = raw
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return "";
  const stripped = line
    .replace(/^#+\s*/, "")
    .replace(/^["'“”‘’「」【】\s]+|["'“”‘’「」【】\s]+$/g, "")
    .replace(/^(标题|title)\s*[:：]\s*/i, "")
    .trim();
  if (!stripped) return "";
  return stripped.length > MAX_TITLE
    ? `${stripped.slice(0, MAX_TITLE - 1)}…`
    : stripped;
}

function buildPrompt(
  userText: string,
  assistantText: string,
  language: string
): string {
  const zh = language === "zh";
  const task = zh
    ? "请为下面这段对话生成一个简短的中文标题（不超过12个字），概括对话主题。只输出标题本身，不要引号、不要标点结尾。"
    : "Write a very short title (max 6 words) that summarizes this conversation. Reply with the title only — no quotes, no trailing punctuation.";
  const convo = [
    `User: ${userText}`,
    assistantText ? `Assistant: ${assistantText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${task}\n\n${convo}`;
}

export async function POST(req: Request) {
  let userText: string;
  let assistantText: string;
  let language: string;
  try {
    const body: unknown = await req.json();
    const raw = (body ?? {}) as Record<string, unknown>;
    const read = (value: unknown) =>
      typeof value === "string" ? value.trim().slice(0, MAX_INPUT) : "";
    userText = read(raw.userText);
    assistantText = read(raw.assistantText);
    language = read(raw.language) === "zh" ? "zh" : "en";
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!userText && !assistantText) {
    return Response.json({ error: '"userText" or "assistantText" is required.' }, { status: 400 });
  }

  const prompt = buildPrompt(userText, assistantText, language);
  // Try the cheapest auto-chain models first; a title never deserves the
  // whole chain or a long timeout.
  for (const model of getChatChain(false).slice(0, 3)) {
    try {
      const raw = await completeOpenCode(model, [{ role: "user", text: prompt }], {
        maxTokens: 64,
        reasoning: "none",
      });
      const title = cleanTitle(raw);
      if (title) return Response.json({ title });
    } catch {
      /* next model in the chain */
    }
  }
  return Response.json({ error: "Could not generate a title." }, { status: 502 });
}
