"use client";

import { useEffect, useState } from "react";

const COMPRESS_KEY = "inschat_compress_images";
const COMPRESS_EVENT = "inschat-compress-images";

// Image compression is ON by default: photos are downscaled to 1600px and
// re-encoded as JPEG q85 before upload (huge input-token savings; reading
// accuracy stays intact at these settings). Toggle off to compare.
export function getCompressImages(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(COMPRESS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setCompressImages(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COMPRESS_KEY, on ? "1" : "0");
  } catch {}
  window.dispatchEvent(new CustomEvent(COMPRESS_EVENT, { detail: on }));
}

export function useCompressImages(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => getCompressImages());
  useEffect(() => {
    const handler = (event: Event) => {
      setOn(Boolean((event as CustomEvent<boolean>).detail));
    };
    window.addEventListener(COMPRESS_EVENT, handler);
    return () => window.removeEventListener(COMPRESS_EVENT, handler);
  }, []);
  return [on, setCompressImages];
}

export type ReasoningEffort = "balance" | "max";

const REASONING_KEY = "inschat_reasoning";
const REASONING_EVENT = "inschat-reasoning";

// Reasoning effort is MAX by default; users can lower it to balance for
// faster replies (vision + direct-fallback requests only — the opencode
// agent keeps its own default). The opencode gateway itself still speaks
// "medium"; the server maps "balance" back to it at the API boundary.
export function getReasoningEffort(): ReasoningEffort {
  if (typeof window === "undefined") return "max";
  try {
    const value = window.localStorage.getItem(REASONING_KEY);
    if (value === "balance" || value === "medium") return "balance";
    return "max";
  } catch {
    return "max";
  }
}

export function setReasoningEffort(level: ReasoningEffort): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REASONING_KEY, level);
  } catch {}
  window.dispatchEvent(new CustomEvent(REASONING_EVENT, { detail: level }));
}

export function useReasoningEffort(): [
  ReasoningEffort,
  (level: ReasoningEffort) => void
] {
  const [level, setLevel] = useState<ReasoningEffort>(() =>
    getReasoningEffort()
  );
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setLevel(detail === "balance" || detail === "medium" ? "balance" : "max");
    };
    window.addEventListener(REASONING_EVENT, handler);
    return () => window.removeEventListener(REASONING_EVENT, handler);
  }, []);
  return [level, setReasoningEffort];
}

// The two user-selectable text models. Defaults to deepseek-v4-flash (the
// off-peak primary); qwen3.8-flash (flat pricing) is the peak-hours choice.
export type SelectedModel = "deepseek-v4-flash" | "qwen3.8-flash";

const MODEL_KEY = "inschat_model";
const MODEL_EVENT = "inschat-model";

export function getSelectedModel(): SelectedModel {
  if (typeof window === "undefined") return "deepseek-v4-flash";
  try {
    return window.localStorage.getItem(MODEL_KEY) === "qwen3.8-flash"
      ? "qwen3.8-flash"
      : "deepseek-v4-flash";
  } catch {
    return "deepseek-v4-flash";
  }
}

export function setSelectedModel(model: SelectedModel): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODEL_KEY, model);
  } catch {}
  window.dispatchEvent(new CustomEvent(MODEL_EVENT, { detail: model }));
}

export function useSelectedModel(): [
  SelectedModel,
  (model: SelectedModel) => void
] {
  const [model, setModel] = useState<SelectedModel>(() => getSelectedModel());
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SelectedModel>).detail;
      setModel(detail === "qwen3.8-flash" ? "qwen3.8-flash" : "deepseek-v4-flash");
    };
    window.addEventListener(MODEL_EVENT, handler);
    return () => window.removeEventListener(MODEL_EVENT, handler);
  }, []);
  return [model, setSelectedModel];
}

// DeepSeek peak hours per official docs: 01:00-04:00 and 06:00-10:00 UTC,
// Monday through Friday. Mirrors lib/models.ts (the client has no node/fs).
export function isDeepSeekPeak(now: Date = new Date()): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (mins >= 60 && mins < 240) || (mins >= 360 && mins < 600);
}

export function useDeepSeekPeak(): boolean {
  const [peak, setPeak] = useState<boolean>(() => isDeepSeekPeak());
  useEffect(() => {
    const tick = () => setPeak(isDeepSeekPeak());
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return peak;
}

export type ChatMode = "build" | "plan";

const MODE_KEY = "inschat_mode";
const MODE_EVENT = "inschat-mode";

// Build (default) = full agent with edit/bash allowlist. Plan = opencode's
// read-only agent (edit/bash denied server-side) for research and proposals.
export function getChatMode(): ChatMode {
  if (typeof window === "undefined") return "build";
  try {
    return window.localStorage.getItem(MODE_KEY) === "plan" ? "plan" : "build";
  } catch {
    return "build";
  }
}

export function setChatMode(mode: ChatMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {}
  window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: mode }));
}

export function useChatMode(): [ChatMode, (mode: ChatMode) => void] {
  const [mode, setMode] = useState<ChatMode>(() => getChatMode());
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ChatMode>).detail;
      setMode(detail === "plan" ? "plan" : "build");
    };
    window.addEventListener(MODE_EVENT, handler);
    return () => window.removeEventListener(MODE_EVENT, handler);
  }, []);
  return [mode, setChatMode];
}
