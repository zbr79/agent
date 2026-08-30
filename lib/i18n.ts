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
    "nav.opencode": "OpenCode",
    "nav.opencodeCalls": "OpenCode 调用",
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
    "opencode.empty": "与 DeepSeek V4 Pro 对话 — 消息仅保存在当前页面，刷新后丢失。",
    "opencodeCalls.title": "OpenCode 调用",
    "opencodeCalls.sub": "本应用通过 opencode-go 订阅对 DeepSeek V4 Pro 发出的调用，记录在 MongoDB。",
    "opencodeCalls.official": "",
    "opencodeCalls.officialSub": "",
    "opencodeCalls.rolling": "5 hour usage",
    "opencodeCalls.weekly": "weekly usage",
    "opencodeCalls.monthly": "monthly usage",
    "opencodeCalls.resets": "Resets in",
    "opencodeCalls.officialUnavailable": "暂时无法读取官方配额。",
    "opencodeCalls.h5": "最近 5 小时",
    "opencodeCalls.w7": "最近 7 天",
    "opencodeCalls.m30": "最近 30 天",
    "opencodeCalls.total": "累计调用",
    "opencodeCalls.failed": "失败（30 天）",
    "opencodeCalls.cost30d": "30 天花费",
    "opencodeCalls.tokens30d": "30 天 tokens",
    "opencodeCalls.byModel": "按模型统计（30 天）",
    "opencodeCalls.recent": "最近调用",
    "opencodeCalls.empty": "还没有 OpenCode 调用 — 去 OpenCode 页面发一条消息。",
    "opencodeCalls.about": "关于这些数字",
    "opencodeCalls.about1": "Go 订阅限额按美元计：每 5 小时 $12、每周 $30、每月 $60。上方请求上限为官方文档给出的 DeepSeek V4 Pro 估算（1,050 / 2,600 / 5,200 次）。",
    "opencodeCalls.about2": "官方配额来自 /zen/go/v1/usage 接口（60 秒缓存）；控制台：opencode.ai/auth。本页的请求数只统计本应用自己的调用。",
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
    "usage.sub": "本应用通过 opencode-go 订阅发出的调用（DeepSeek V4 Pro / Flash / Vision Exp）",
    "usage.colModel": "模型",
    "usage.colSent": "30 天调用",
    "usage.colStatus": "状态",
    "usage.inUse": "使用中",
    "usage.available": "可用",
    "usage.usedPct": "已用",
    "lang.button": "EN",
  },
  en: {
    "nav.chat": "Chat",
    "nav.opencode": "OpenCode",
    "nav.opencodeCalls": "OpenCode Calls",
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
    "opencode.empty": "Chat with DeepSeek V4 Pro — messages live only on this page and are lost on refresh.",
    "opencodeCalls.title": "OpenCode Calls",
    "opencodeCalls.sub": "DeepSeek V4 Pro calls made by this app through the opencode-go subscription, logged in MongoDB.",
    "opencodeCalls.official": "",
    "opencodeCalls.officialSub": "",
    "opencodeCalls.rolling": "5 hour usage",
    "opencodeCalls.weekly": "weekly usage",
    "opencodeCalls.monthly": "monthly usage",
    "opencodeCalls.resets": "Resets in",
    "opencodeCalls.officialUnavailable": "Official quota is unavailable right now.",
    "opencodeCalls.h5": "Last 5 hours",
    "opencodeCalls.w7": "Last 7 days",
    "opencodeCalls.m30": "Last 30 days",
    "opencodeCalls.total": "Total calls",
    "opencodeCalls.failed": "Failed (30d)",
    "opencodeCalls.cost30d": "Cost (30d)",
    "opencodeCalls.tokens30d": "Tokens (30d)",
    "opencodeCalls.byModel": "Per model (30d)",
    "opencodeCalls.recent": "Recent calls",
    "opencodeCalls.empty": "No OpenCode calls yet — send a message on the OpenCode page.",
    "opencodeCalls.about": "About these numbers",
    "opencodeCalls.about1": "Go limits are dollar-based: $12 per 5h, $30 per week, $60 per month. The caps above are OpenCode's published DeepSeek V4 Pro request estimates (1,050 / 2,600 / 5,200).",
    "opencodeCalls.about2": "Official quota comes from the /zen/go/v1/usage endpoint (60s cache); console: opencode.ai/auth. The request counts above are only this app's own calls.",
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
    "usage.sub": "Calls made by this app through the opencode-go subscription (DeepSeek V4 Pro / Flash / Vision Exp)",
    "usage.colModel": "Model",
    "usage.colSent": "Calls (30d)",
    "usage.colStatus": "Status",
    "usage.inUse": "in use",
    "usage.available": "available",
    "usage.usedPct": "used",
    "lang.button": "中文",
  },
};
