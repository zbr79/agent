import { getUserFromRequest } from "@/lib/auth";
import { isWhisperUp, transcribeAudio, type WhisperLanguage } from "@/lib/whisper";
import {
  GUEST_MAX_AUDIO_MS,
  MAX_AUDIO_BYTES,
  USER_MAX_AUDIO_MS,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function parseLanguage(raw: FormDataEntryValue | null): WhisperLanguage {
  if (raw === "zh" || raw === "en" || raw === "auto") return raw;
  return "auto";
}

function parseDurationMs(form: FormData): number | null {
  for (const key of ["durationMs", "duration_ms"]) {
    const raw = form.get(key);
    if (typeof raw !== "string" || !raw.trim()) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function wavDurationMs(buf: Buffer): number | null {
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  if (!channels || !sampleRate || !bits) return null;
  const bytesPerSecond = sampleRate * channels * (bits / 8);
  if (!bytesPerSecond) return null;
  return Math.round((Math.max(0, buf.length - 44) / bytesPerSecond) * 1000);
}

export async function POST(req: Request) {
  // Guests are allowed. Signed-in status only raises the clip length cap.
  // Do not write audio or transcripts to disk or Mongo, and do not log a /calls entry.
  const user = await getUserFromRequest(req);
  const signedIn = Boolean(user);
  const maxMs = signedIn ? USER_MAX_AUDIO_MS : GUEST_MAX_AUDIO_MS;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing audio file." }, { status: 400 });
  }

  const mime = file.type || "";
  if (!mime.startsWith("audio/")) {
    return Response.json({ error: "File must be audio/*." }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio is too large." }, { status: 413 });
  }

  const durationMs = parseDurationMs(form);
  if (durationMs != null && durationMs > maxMs) {
    return Response.json({ error: "Audio is too long." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio is too large." }, { status: 413 });
  }

  const wavMs = wavDurationMs(bytes);
  if (wavMs != null && wavMs > maxMs + 750) {
    return Response.json({ error: "Audio is too long." }, { status: 413 });
  }

  if (!(await isWhisperUp())) {
    return Response.json({ error: "Transcription is unavailable." }, { status: 503 });
  }

  try {
    const wav = new Blob([new Uint8Array(bytes)], { type: mime || "audio/wav" });
    const { text } = await transcribeAudio(wav, parseLanguage(form.get("language")));
    return Response.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    const timedOut = /timeout|aborted/i.test(message);
    return Response.json({ error: message }, { status: timedOut ? 504 : 502 });
  }
}