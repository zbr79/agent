const TARGET_RATE = 16000;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/aac",
  "audio/ogg;codecs=opus",
];

export type VoiceErrorCode = "unsupported" | "denied" | "decode" | "empty" | "cancelled";

export class VoiceInputError extends Error {
  code: VoiceErrorCode;

  constructor(code: VoiceErrorCode, message: string) {
    super(message);
    this.name = "VoiceInputError";
    this.code = code;
  }
}

export type VoiceRecording = {
  blob: Blob;
  durationMs: number;
};

export type VoiceRecordHandle = {
  stop: () => void;
  cancel: () => void;
  result: Promise<VoiceRecording>;
};

export function isVoiceInputSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const AudioCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Boolean(
    navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined" &&
      AudioCtor
  );
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime));
}

function downmixMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  if (channels <= 1) return buffer.getChannelData(0).slice();
  const mixed = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) mixed[i] += data[i] / channels;
  }
  return mixed;
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const index = Math.floor(pos);
    const frac = pos - index;
    const a = input[index] ?? 0;
    const b = input[Math.min(index + 1, input.length - 1)] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function toWav16k(blob: Blob): Promise<Blob> {
  const AudioCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) {
    throw new VoiceInputError("decode", "Could not decode this recording.");
  }
  const ctx = new AudioCtor();
  try {
    const raw = await blob.arrayBuffer();
    let decoded: AudioBuffer;
    try {
      decoded = await Promise.race([
        ctx.decodeAudioData(raw.slice(0)),
        new Promise<AudioBuffer>((_, reject) => {
          window.setTimeout(
            () =>
              reject(
                new VoiceInputError(
                  "decode",
                  "Could not decode this recording. On iPhone, Safari often cannot decode the recorded mp4."
                )
              ),
            15000
          );
        }),
      ]);
    } catch (error) {
      if (error instanceof VoiceInputError) throw error;
      throw new VoiceInputError(
        "decode",
        "Could not decode this recording. On iPhone, Safari often cannot decode the recorded mp4."
      );
    }
    const mono = downmixMono(decoded);
    const pcm = resampleLinear(mono, decoded.sampleRate, TARGET_RATE);
    if (!pcm.length) throw new VoiceInputError("empty", "Recording was empty.");
    return encodeWavPcm16(pcm, TARGET_RATE);
  } finally {
    void ctx.close().catch(() => {});
  }
}

export function recordVoice(opts: {
  maxMs: number;
  onTick?: (elapsedMs: number) => void;
}): VoiceRecordHandle {
  if (!isVoiceInputSupported()) {
    const error = new VoiceInputError("unsupported", "Voice input is not supported in this browser.");
    return {
      stop: () => {},
      cancel: () => {},
      result: Promise.reject(error),
    };
  }

  let cancelled = false;
  let settled = false;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let tickTimer = 0;
  let maxTimer = 0;
  const chunks: Blob[] = [];

  const cleanupTimers = () => {
    if (tickTimer) window.clearInterval(tickTimer);
    if (maxTimer) window.clearTimeout(maxTimer);
    tickTimer = 0;
    maxTimer = 0;
  };

  const stopTracks = () => {
    stream?.getTracks().forEach((track) => track.stop());
  };

  let rejectResult: (error: Error) => void = () => {};
  let resolveResult: (value: VoiceRecording) => void = () => {};

  const result = new Promise<VoiceRecording>((resolve, reject) => {
    resolveResult = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    rejectResult = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
  });

  const stop = () => {
    cleanupTimers();
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* onstop may still fire */
      }
      return;
    }
    if (!recorder && !settled) {
      stopTracks();
      rejectResult(new VoiceInputError("cancelled", "Recording cancelled."));
    }
  };

  const cancel = () => {
    cancelled = true;
    cleanupTimers();
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* fall through */
      }
    }
    stopTracks();
    rejectResult(new VoiceInputError("cancelled", "Recording cancelled."));
  };

  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (cancelled) {
        stopTracks();
        rejectResult(new VoiceInputError("cancelled", "Recording cancelled."));
        return;
      }

      const mime = pickMime();
      try {
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch {
        stopTracks();
        rejectResult(new VoiceInputError("unsupported", "Could not start the recorder."));
        return;
      }

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      const recorded = new Promise<Blob>((resolve, reject) => {
        recorder!.onerror = () => reject(new VoiceInputError("empty", "Recording failed."));
        recorder!.onstop = () => {
          const type = recorder?.mimeType || chunks[0]?.type || "audio/webm";
          resolve(new Blob(chunks, { type }));
        };
      });

      recorder.start();
      const startedAt = Date.now();
      opts.onTick?.(0);
      tickTimer = window.setInterval(() => {
        opts.onTick?.(Date.now() - startedAt);
      }, 200);
      maxTimer = window.setTimeout(stop, Math.max(1000, opts.maxMs));

      const blob = await recorded;
      const durationMs = Math.max(0, Date.now() - startedAt);
      cleanupTimers();
      stopTracks();

      if (cancelled) {
        rejectResult(new VoiceInputError("cancelled", "Recording cancelled."));
        return;
      }
      if (!blob.size) {
        rejectResult(new VoiceInputError("empty", "Recording was empty."));
        return;
      }

      const wav = await toWav16k(blob);
      if (cancelled) {
        rejectResult(new VoiceInputError("cancelled", "Recording cancelled."));
        return;
      }
      resolveResult({ blob: wav, durationMs });
    } catch (error) {
      cleanupTimers();
      stopTracks();
      if (cancelled || (error instanceof VoiceInputError && error.code === "cancelled")) {
        rejectResult(new VoiceInputError("cancelled", "Recording cancelled."));
        return;
      }
      if (error instanceof VoiceInputError) {
        rejectResult(error);
        return;
      }
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
        rejectResult(new VoiceInputError("denied", "Microphone permission was denied."));
        return;
      }
      rejectResult(new VoiceInputError("denied", "Could not access the microphone."));
    }
  })();

  return { stop, cancel, result };
}