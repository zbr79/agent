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

export type ReasoningEffort = "max" | "medium";

const REASONING_KEY = "inschat_reasoning";
const REASONING_EVENT = "inschat-reasoning";

// Reasoning effort is MAX by default (unchanged behavior); users can lower it
// to medium for faster replies (vision + direct-fallback requests only —
// the opencode agent keeps its own default).
export function getReasoningEffort(): ReasoningEffort {
  if (typeof window === "undefined") return "max";
  try {
    const value = window.localStorage.getItem(REASONING_KEY);
    return value === "medium" ? value : "max";
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
      const detail = (event as CustomEvent<ReasoningEffort>).detail;
      setLevel(detail === "medium" ? detail : "max");
    };
    window.addEventListener(REASONING_EVENT, handler);
    return () => window.removeEventListener(REASONING_EVENT, handler);
  }, []);
  return [level, setReasoningEffort];
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
