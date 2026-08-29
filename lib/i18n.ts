"use client";

import { useEffect, useState } from "react";

export type UiLang = "zh" | "en";

const KEY = "inschat_ui_lang";
const EVENT = "inschat-lang";

export function getUiLang(): UiLang {
  if (typeof window === "undefined") return "zh";
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === "en" || raw === "zh") return raw;
  } catch {}
  return "zh";
}

export function setUiLang(lang: UiLang): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: lang }));
}

export function useUiLang(): UiLang {
  const [lang, setLang] = useState<UiLang>(() => getUiLang());
  useEffect(() => {
    const onLang = (event: Event) => {
      setLang((event as CustomEvent<UiLang>).detail);
    };
    window.addEventListener(EVENT, onLang);
    return () => window.removeEventListener(EVENT, onLang);
  }, []);
  return lang;
}

export const STR: Record<UiLang, Record<string, string>> = {
  zh: {
    "nav.chat": "聊天",
    "nav.records": "记录",
    "nav.calls": "调用",
    "nav.models": "模型",
    "nav.usage": "用量",
    "nav.newChat": "+ 新对话",
    "nav.signIn": "登录",
    "nav.signOut": "退出登录",
    "nav.loading": "加载中…",
    "nav.noSessions": "还没有保存的对话。",
    "nav.guestHint": "访客对话保存在本设备上。",
    "thinking": "思考中…",
    "records.title": "记录",
    "records.subGuest": "已保存的报告（访客模式 — 仅保存在本设备）。",
    "records.subOwner": "时间线上的已保存报告，最新在前。",
    "records.empty": "还没有保存内容 — 聊天后点击 Conclude 并保存。",
    "records.loading": "加载中…",
    "records.delete": "删除",
    "records.deleting": "删除中…",
    "records.today": "今天",
    "records.yesterday": "昨天",
    "usage.title": "API 用量",
    "usage.sub": "本应用对 Gemini 免费层发出的调用",
    "usage.requestsToday": "今日请求",
    "usage.requestsMinute": "过去 60 秒内的请求",
    "usage.failed": "今日失败调用",
    "usage.catalog": "模型目录 — 每个模型今日已发送的请求数",
    "usage.catalogNote": "此页面不运行实时检查；仅展示已知模型目录及本应用今日对每个模型的调用次数。",
    "usage.colModel": "模型",
    "usage.colSent": "今日已发送",
    "usage.colStatus": "状态",
    "usage.retired": "已下线",
    "usage.ranOut": "额度耗尽",
    "usage.inUse": "使用中",
    "usage.available": "可用",
    "usage.resets": "重置",
    "usage.usedPct": "已用",
    "usage.aboutTitle": "关于这些限制",
    "lang.button": "EN",
  },
  en: {
    "nav.chat": "Chat",
    "nav.records": "Records",
    "nav.calls": "Calls",
    "nav.models": "Models",
    "nav.usage": "Usage",
    "nav.newChat": "+ New chat",
    "nav.signIn": "Sign in",
    "nav.signOut": "Sign out",
    "nav.loading": "Loading…",
    "nav.noSessions": "No saved chats yet.",
    "nav.guestHint": "Guest chats save on this device.",
    "thinking": "Thinking…",
    "records.title": "Records",
    "records.subGuest": "Saved reports (guest mode — stored on this device only).",
    "records.subOwner": "Saved reports on a timeline. Newest first.",
    "records.empty": "Nothing saved yet — chat, then click Conclude and Save.",
    "records.loading": "Loading…",
    "records.delete": "Delete",
    "records.deleting": "Deleting…",
    "records.today": "Today",
    "records.yesterday": "Yesterday",
    "usage.title": "API Usage",
    "usage.sub": "Calls made by this app against the Gemini free tier",
    "usage.requestsToday": "Requests today",
    "usage.requestsMinute": "Requests in the last 60 seconds",
    "usage.failed": "Failed calls today",
    "usage.catalog": "Model catalog — requests sent today per model",
    "usage.catalogNote": "No live checks run on this page; this shows the known model catalog and how many calls this app has already sent to each model today.",
    "usage.colModel": "Model",
    "usage.colSent": "Sent today",
    "usage.colStatus": "Status",
    "usage.retired": "retired",
    "usage.ranOut": "ran out",
    "usage.inUse": "in use",
    "usage.available": "available",
    "usage.resets": "resets",
    "usage.usedPct": "used",
    "usage.aboutTitle": "About these limits",
    "lang.button": "中文",
  },
};
