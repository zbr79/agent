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
