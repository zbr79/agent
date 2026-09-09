import type { ChatMessage } from "./types";

/** Used only when /config/providers does not expose limit.context. */
export const FALLBACK_CONTEXT_TOKENS = 24_000;
export const COMPACT_RATIO = 0.7;
const COMPACT_KEEP_TURNS = 4;
const SUMMARY_TURN_CHARS = 240;
const SUMMARY_MAX_CHARS = 6_000;

export function compactAt(contextTokens: number): number {
  const window = contextTokens > 0 ? contextTokens : FALLBACK_CONTEXT_TOKENS;
  return Math.floor(window * COMPACT_RATIO);
}

export function sessionTitleFor(ownerKey: string): string {
  return `inschat:${ownerKey}`.slice(0, 120);
}

export class AgentBusyError extends Error {
  constructor() {
    super("A reply is already in progress for this chat.");
    this.name = "AgentBusyError";
  }
}

const inflightOwners = new Map<string, { sessionId: string | null; at: number }>();
const inflightSessions = new Map<string, string>();

export function claimAgentTurn(ownerKey: string, timeoutMs: number): void {
  const existing = inflightOwners.get(ownerKey);
  if (existing && Date.now() - existing.at < timeoutMs) {
    throw new AgentBusyError();
  }
  inflightOwners.set(ownerKey, { sessionId: null, at: Date.now() });
}

export function noteInflightSession(ownerKey: string, sessionId: string): void {
  const other = inflightSessions.get(sessionId);
  if (other && other !== ownerKey) {
    throw new AgentBusyError();
  }
  const current = inflightOwners.get(ownerKey);
  if (current?.sessionId && current.sessionId !== sessionId) {
    inflightSessions.delete(current.sessionId);
  }
  if (current) current.sessionId = sessionId;
  inflightSessions.set(sessionId, ownerKey);
}

export function releaseAgentTurn(ownerKey: string | null | undefined): void {
  if (!ownerKey) return;
  const current = inflightOwners.get(ownerKey);
  if (current?.sessionId) inflightSessions.delete(current.sessionId);
  inflightOwners.delete(ownerKey);
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function lineFor(message: ChatMessage): string {
  const speaker = message.role === "model" ? "Assistant" : "User";
  const photo = (message.images?.length ?? 0) > 0 ? " [photo]" : "";
  const text = message.text.trim() || (photo ? "[photo attached]" : "");
  return `${speaker}: ${clip(text, SUMMARY_TURN_CHARS)}${photo}`;
}

function usableTurns(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(
    (message) => message.text.trim().length > 0 || (message.images?.length ?? 0) > 0
  );
}

/**
 * Brief recap for a fresh opencode session. Older turns are condensed;
 * the last few turns are kept as labeled lines. Not the old fake
 * "reply to the last User:/Assistant: dump".
 */
export function seedFromHistory(
  prior: ChatMessage[],
  reason: "rebuild" | "compact"
): string | null {
  const turns = usableTurns(prior);
  if (turns.length === 0) {
    if (reason !== "rebuild") return null;
    return [
      "[Context restored]",
      "The previous agent thread was lost and no stored transcript was available.",
      "If the user refers to earlier work, say the earlier thread was lost and ask them to repeat what matters.",
      "Do not invent a previous conversation. Answer only the next user message.",
    ].join("\n");
  }
  const keep = turns.slice(-COMPACT_KEEP_TURNS);
  const older = turns.slice(0, -COMPACT_KEEP_TURNS);
  let olderText = older.map(lineFor).join("\n");
  if (olderText.length > SUMMARY_MAX_CHARS) {
    olderText = `${olderText.slice(0, SUMMARY_MAX_CHARS)}\n…(${older.length} earlier turns condensed)`;
  }
  const why =
    reason === "compact"
      ? "The previous agent thread was compacted because its prompt size passed about 70% of the model context window."
      : "The previous agent thread was lost (opencode restart or the session was gone) and has been rebuilt from the stored transcript.";
  return [
    "[Context restored]",
    why,
    "Continue the same chat. Do not repeat this recap. The next user message is the one to answer.",
    older.length ? `Summary of older turns:\n${olderText}` : "",
    `Recent turns:\n${keep.map(lineFor).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function ownerTurnBusy(ownerKey: string): boolean {
  const existing = inflightOwners.get(ownerKey);
  return Boolean(existing);
}

export function inflightSessionFor(ownerKey: string): string | null {
  return inflightOwners.get(ownerKey)?.sessionId ?? null;
}
