const WHISPER_PORT = process.env.WHISPER_PORT || "9081";
export const WHISPER_URL = `http://127.0.0.1:${WHISPER_PORT}`;

export type WhisperLanguage = "zh" | "en" | "auto";

function extractText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  if (typeof record.text === "string") return record.text.trim();
  if (typeof record.result === "string") return record.result.trim();
  return "";
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
  // Live model is ggml-tiny.en. Always request English so a zh UI
  // does not send language=zh and stall or return empty text.
  void language;
  form.append("language", "en");

  const res = await fetch(`${WHISPER_URL}/inference`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120000),
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