"use client";

import { useEffect, useState } from "react";

const KEY = "inschat_insulin_mode";
const EVENT = "inschat-insulin-mode";

// Insulin (preset) mode is OFF by default: free chat unless enabled.
export function getInsulinMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setInsulinMode(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

export function useInsulinMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => getInsulinMode());
  useEffect(() => {
    const handler = (event: Event) => {
      setOn(Boolean((event as CustomEvent<boolean>).detail));
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);
  return [on, setInsulinMode];
}

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
