"use client";

import type { ChatImage, SessionConclusion, WorkspaceId } from "./types";
import type { ActivityEvent } from "./markers";

export interface GuestMessage {
  role: "user" | "model";
  text: string;
  images?: ChatImage[];
  imageKeys?: string[];
  model?: string;
  elapsed?: number;
  activities?: ActivityEvent[];
}

export interface GuestSession {
  id: string;
  title: string;
  updatedAt: number;
  workspaceId: WorkspaceId;
  messages: GuestMessage[];
  pinned?: boolean;
  conclusion?: SessionConclusion | null;
  recordId?: string | null;
}

const SESSIONS_KEY = "inschat_guest_sessions";

function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function writeSessions(sessions: GuestSession[]): void {
  if (writeJson(SESSIONS_KEY, sessions)) return;
  // Quota exceeded: drop images everywhere, then shrink the list, then give up.
  const withoutImages = sessions.map((session) => ({
    ...session,
    messages: session.messages.map((message) => ({ ...message, images: undefined })),
  }));
  if (writeJson(SESSIONS_KEY, withoutImages)) return;
  writeJson(SESSIONS_KEY, withoutImages.slice(-10));
}

function normalizeSession(session: GuestSession): GuestSession {
  return { ...session, workspaceId: session.workspaceId ?? "agent" };
}

export function listGuestSessions(): GuestSession[] {
  return readJson<GuestSession[]>(SESSIONS_KEY, [])
    .map(normalizeSession)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getGuestSession(id: string): GuestSession | null {
  const session = readJson<GuestSession[]>(SESSIONS_KEY, []).find((s) => s.id === id);
  return session ? normalizeSession(session) : null;
}

export function createGuestSession(
  title: string,
  workspaceId: WorkspaceId = "agent"
): GuestSession {
  const session: GuestSession = {
    id: newId(),
    title,
    updatedAt: Date.now(),
    workspaceId,
    messages: [],
  };
  writeSessions([session, ...readJson<GuestSession[]>(SESSIONS_KEY, [])]);
  return session;
}

export function appendGuestMessage(sessionId: string, message: GuestMessage): void {
  const sessions = readJson<GuestSession[]>(SESSIONS_KEY, []);
  const target = sessions.find((session) => session.id === sessionId);
  if (!target) return;
  target.messages.push(message);
  target.updatedAt = Date.now();
  writeSessions(sessions);
}

export function setGuestConclusion(
  sessionId: string,
  conclusion: SessionConclusion | null,
  recordId?: string | null
): void {
  const sessions = readJson<GuestSession[]>(SESSIONS_KEY, []);
  const target = sessions.find((session) => session.id === sessionId);
  if (!target) return;
  target.conclusion = conclusion ?? null;
  if (recordId !== undefined) target.recordId = recordId ?? null;
  target.updatedAt = Date.now();
  writeSessions(sessions);
}

export function renameGuestSession(sessionId: string, title: string): void {
  const sessions = readJson<GuestSession[]>(SESSIONS_KEY, []);
  const target = sessions.find((session) => session.id === sessionId);
  if (!target) return;
  target.title = title;
  target.updatedAt = Date.now();
  writeSessions(sessions);
}

export function pinGuestSession(sessionId: string, pinned: boolean): void {
  const sessions = readJson<GuestSession[]>(SESSIONS_KEY, []);
  const target = sessions.find((session) => session.id === sessionId);
  if (!target) return;
  target.pinned = pinned;
  target.updatedAt = Date.now();
  writeSessions(sessions);
}

export function truncateGuestSession(sessionId: string, keep: number): void {
  const sessions = readJson<GuestSession[]>(SESSIONS_KEY, []);
  const target = sessions.find((session) => session.id === sessionId);
  if (!target) return;
  target.messages = target.messages.slice(0, keep);
  target.conclusion = null;
  target.updatedAt = Date.now();
  writeSessions(sessions);
}

export function deleteGuestSession(id: string): void {
  writeSessions(
    readJson<GuestSession[]>(SESSIONS_KEY, []).filter((session) => session.id !== id)
  );
}

export function clearGuestSessions(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSIONS_KEY);
  } catch {}
}
