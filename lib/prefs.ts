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

// GPT-6 Luna is the default model. The other models remain available as
// explicit choices, while DeepSeek is still locked during its peak window.
export type SelectedModel =
  | "gpt-6-luna"
  | "deepseek-v4-flash"
  | "qwen3.8-flash"
  | "glm-5.3-flash";

const MODEL_KEY = "inschat_model";
const MODEL_EVENT = "inschat-model";

function normalizeModel(value: unknown): SelectedModel {
  if (
    value === "gpt-6-luna" ||
    value === "deepseek-v4-flash" ||
    value === "qwen3.8-flash" ||
    value === "glm-5.3-flash"
  ) {
    return value;
  }
  return "gpt-6-luna";
}

// Peak-hours guard: DeepSeek V4 Flash is unavailable while its price is
// doubled, so the effective selection becomes Qwen3.8 Flash instead.
function effectiveModel(value: SelectedModel): SelectedModel {
  return value === "deepseek-v4-flash" && isDeepSeekPeak()
    ? "qwen3.8-flash"
    : value;
}

export function getSelectedModel(): SelectedModel {
  if (typeof window === "undefined") return "gpt-6-luna";
  try {
    return effectiveModel(normalizeModel(window.localStorage.getItem(MODEL_KEY)));
  } catch {
    return "gpt-6-luna";
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
      setModel(effectiveModel(normalizeModel((event as CustomEvent<unknown>).detail)));
    };
    window.addEventListener(MODEL_EVENT, handler);
    return () => window.removeEventListener(MODEL_EVENT, handler);
  }, []);
  useEffect(() => {
    // Persist the auto-downgrade: if the stored pick is DeepSeek while peak
    // is on (fresh load, or peak just started), switch the selection to
    // Qwen3.8 Flash so the pill shows it before the picker is ever opened.
    const sync = () => {
      if (!isDeepSeekPeak()) return;
      try {
        if (window.localStorage.getItem(MODEL_KEY) === "deepseek-v4-flash") {
          setSelectedModel("qwen3.8-flash");
        }
      } catch {}
    };
    sync();
    const id = window.setInterval(sync, 60_000);
    return () => window.clearInterval(id);
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

const CHANGES_OPEN_KEY = "inschat_changes_open";
const CHANGES_OPEN_EVENT = "inschat-changes-open";

// The "Files changed" card starts collapsed to a single title line; once the
// user expands it, the choice sticks — for every card and across reloads.
export function getChangesOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CHANGES_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setChangesOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHANGES_OPEN_KEY, open ? "1" : "0");
  } catch {}
  window.dispatchEvent(new CustomEvent(CHANGES_OPEN_EVENT, { detail: open }));
}

export function useChangesOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => getChangesOpen());
  useEffect(() => {
    const handler = (event: Event) => {
      setOpen(Boolean((event as CustomEvent<boolean>).detail));
    };
    window.addEventListener(CHANGES_OPEN_EVENT, handler);
    return () => window.removeEventListener(CHANGES_OPEN_EVENT, handler);
  }, []);
  return [open, setChangesOpen];
}
