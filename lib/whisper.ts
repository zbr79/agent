import { readFileSync } from "fs";

const WHISPER_PORT = process.env.WHISPER_PORT || "9081";
export const WHISPER_URL = `http://127.0.0.1:${WHISPER_PORT}`;
const MODEL_STAMP =
  process.env.WHISPER_MODEL_STAMP ||
  "/home/ubuntu/opencode-tmp/agent/whisper-model";

export type WhisperLanguage = "zh" | "en" | "auto";

function extractText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  if (typeof record.text === "string") return record.text.trim();
  if (typeof record.result === "string") return record.result.trim();
  return "";
}

export function loadedWhisperModel(): string {
  const fromEnv = process.env.WHISPER_MODEL?.trim();
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(/*turbopackIgnore: true*/ MODEL_STAMP, "utf8").trim().split(/\r?\n/, 1)[0] ?? "";
  } catch {
    return "";
  }
}

/** ggml-tiny.en.bin / ggml-tiny.en-q5_1.bin cannot take language=zh. */
export function isEnglishOnlyWhisperModel(modelPath: string): boolean {
  const name = modelPath.split(/[/\\]/).pop() || modelPath;
  return /\.en(?:[.-]|$)/i.test(name);
}

/**
 * zh only if the loaded weights are multilingual.
 * en is always forwarded. auto detects on multilingual models, else en.
 * Unknown model path: honor the request (detect if auto) rather than forcing zh
 * onto an unseen .en file — callers should stamp the path from start-whisper.sh.
 */
export function chooseWhisperLanguage(
  requested: WhisperLanguage,
  modelPath = loadedWhisperModel()
): WhisperLanguage {
  const englishOnly = Boolean(modelPath) && isEnglishOnlyWhisperModel(modelPath);
  if (requested === "en" || englishOnly) return "en";
  if (requested === "zh") return "zh";
  return "auto";
}

export async function isWhisperUp(): Promise<boolean> {
  try {
    const res = await fetch(`${WHISPER_URL}/`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function transcribeAudio(
  wav: Blob,
  language: WhisperLanguage
): Promise<{ text: string }> {
  const form = new FormData();
  form.append("file", wav, "audio.wav");
  form.append("response_format", "json");
  form.append("temperature", "0.0");
  form.append("temperature_inc", "0.2");
  form.append("translate", "false");
  form.append("no_timestamps", "true");
  const chosen = chooseWhisperLanguage(language);
  // "auto" lets whisper detect; zh/en are hints for the multilingual model.
  form.append("language", chosen);

  const res = await fetch(`${WHISPER_URL}/inference`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(240000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `whisper inference failed (${res.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`
    );
  }

  const raw = await res.text();
  let text = "";
  try {
    text = extractText(JSON.parse(raw));
  } catch {
    text = raw.trim();
  }
  return { text };
}
