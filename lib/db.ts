import { Db, MongoClient, ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import type {
  AgentBinding,
  ApiCall,
  ChatImage,
  ChatMessage,
  ChatSession,
  SessionConclusion,
  StoredMessage,
} from "./types";

const DB_NAME = process.env.MONGODB_DB || "inschat";

let clientPromise: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return Promise.reject(
      new Error("MONGODB_URI is not configured on the server.")
    );
  }
  if (!clientPromise) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    clientPromise = client.connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  return (await getClient()).db(DB_NAME);
}

interface CallDoc {
  _id?: ObjectId;
  kind: "chat" | "conclude" | "health" | "opencode";
  model: string;
  ok: boolean;
  error?: string;
  at: Date;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

export function toApiCall(doc: CallDoc): ApiCall {
  return {
    _id: doc._id?.toString() ?? "",
    kind: doc.kind,
    model: doc.model,
    ok: doc.ok,
    error: doc.error,
    at: doc.at.toISOString(),
    cost: doc.cost,
    tokens: doc.tokens,
  };
}

export async function insertCall(input: {
  kind: "chat" | "conclude" | "health" | "opencode";
  model: string;
  ok: boolean;
  error?: string;
  cost?: number;
  tokens?: CallDoc["tokens"];
}): Promise<void> {
  const db = await getDb();
  const doc: CallDoc = { ...input, at: new Date() };
  await db.collection<CallDoc>("calls").insertOne(doc);
}

export async function listCalls(limit = 100): Promise<ApiCall[]> {
  const db = await getDb();
  const docs = await db
    .collection<CallDoc>("calls")
    .find({})
    .sort({ at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toApiCall);
}

export async function countCalls(): Promise<{ total: number; failed: number }> {
  const db = await getDb();
  const collection = db.collection<CallDoc>("calls");
  const [total, failed] = await Promise.all([
    collection.countDocuments(),
    collection.countDocuments({ ok: false }),
  ]);
  return { total, failed };
}

export interface OpenCodeUsage {
  total: number;
  last5h: number;
  last7d: number;
  last30d: number;
  failed30d: number;
  cost30d: number;
  tokens30d: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
  models: { model: string; count: number }[];
  recent: ApiCall[];
}

export async function getOpenCodeUsage(): Promise<OpenCodeUsage> {
  const db = await getDb();
  const collection = db.collection<CallDoc>("calls");
  const now = new Date();
  const since5h = new Date(now.getTime() - 5 * 3600_000);
  const since7d = new Date(now.getTime() - 7 * 86400_000);
  const since30d = new Date(now.getTime() - 30 * 86400_000);
  const [total, failed30d, last5h, last7d, last30d, byModel, recent, costAgg] =
    await Promise.all([
      collection.countDocuments({ kind: "opencode" }),
      collection.countDocuments({
        kind: "opencode",
        ok: false,
        at: { $gte: since30d },
      }),
      collection.countDocuments({ kind: "opencode", at: { $gte: since5h } }),
      collection.countDocuments({ kind: "opencode", at: { $gte: since7d } }),
      collection.countDocuments({ kind: "opencode", at: { $gte: since30d } }),
      collection
        .aggregate<{ _id: string; count: number }>([
          { $match: { kind: "opencode", at: { $gte: since30d } } },
          { $group: { _id: "$model", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ])
        .toArray(),
      collection
        .find({ kind: "opencode" })
        .sort({ at: -1 })
        .limit(50)
        .toArray(),
      collection
        .aggregate<{
          cost: number;
          input: number;
          output: number;
          reasoning: number;
          cacheRead: number;
          cacheWrite: number;
        }>([
          { $match: { kind: "opencode", at: { $gte: since30d } } },
          {
            $group: {
              _id: null,
              cost: { $sum: { $ifNull: ["$cost", 0] } },
              input: { $sum: { $ifNull: ["$tokens.input", 0] } },
              output: { $sum: { $ifNull: ["$tokens.output", 0] } },
              reasoning: { $sum: { $ifNull: ["$tokens.reasoning", 0] } },
              cacheRead: { $sum: { $ifNull: ["$tokens.cacheRead", 0] } },
              cacheWrite: { $sum: { $ifNull: ["$tokens.cacheWrite", 0] } },
            },
          },
        ])
        .toArray(),
    ]);
  const agg = costAgg[0] ?? {
    cost: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  return {
    total,
    last5h,
    last7d,
    last30d,
    failed30d,
    cost30d: Math.round(agg.cost * 10000) / 10000,
    tokens30d: {
      input: agg.input,
      output: agg.output,
      reasoning: agg.reasoning,
      cacheRead: agg.cacheRead,
      cacheWrite: agg.cacheWrite,
    },
    models: byModel.map((row) => ({
      model: row._id ?? "unknown",
      count: row.count,
    })),
    recent: recent.map(toApiCall),
  };
}

interface SessionDoc {
  _id?: ObjectId;
  userId?: ObjectId;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  pinned?: boolean;
  conclusion?: SessionConclusion | null;
  recordId?: string | null;
  /** Opencode session that carries the model's real memory for this chat. */
  opencodeSessionId?: string;
  opencodePromptTokens?: number;
  /** Legacy names written by earlier builds; read as a fallback. */
  agentSessionId?: string;
  agentTokens?: number;
}

interface MessageDoc {
  _id?: ObjectId;
  sessionId: ObjectId;
  role: "user" | "model";
  text: string;
  images?: ChatImage[];
  model?: string;
  elapsed?: number;
  createdAt: Date;
  status?: "pending" | "done" | "failed";
  updatedAt?: Date;
  processSteps?: string[];
}

const MAX_MESSAGE_TEXT = 100_000;
// Model messages stream server-side heartbeats every 10 s while a run is
// live; a pending doc untouched for this long has missed ~9 beats, so the
// process that owned it is gone.
const PENDING_STALE_MS = 90_000;

// A pending doc whose heartbeat went stale has no live handler left. If it
// streamed an answer, that answer is real — only the finalizer died — so
// close it as done rather than flagging a complete reply "interrupted".
function stalePendingOutcome(doc: { text?: string }): {
  status: "done" | "failed";
  text: string;
} {
  if (doc.text?.trim()) return { status: "done", text: doc.text };
  return {
    status: "failed",
    text: "[Interrupted — the server stopped before finishing this reply.]",
  };
}

function toChatSession(doc: SessionDoc): ChatSession {
  return {
    _id: doc._id?.toString() ?? "",
    title: doc.title,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    pinned: doc.pinned,
  };
}

function toStoredMessage(doc: MessageDoc): StoredMessage {
  return {
    _id: doc._id?.toString() ?? "",
    sessionId: doc.sessionId.toString(),
    role: doc.role,
    text: doc.text,
    images: doc.images,
    model: doc.model,
    elapsed: doc.elapsed,
    createdAt: doc.createdAt.toISOString(),
    status: doc.status ?? "done",
    updatedAt: doc.updatedAt?.toISOString(),
    processSteps: doc.processSteps,
  };
}

export async function insertSession(userId: string, title: string): Promise<ChatSession> {
  const db = await getDb();
  const now = new Date();
  const doc: SessionDoc = { userId: new ObjectId(userId), title, createdAt: now, updatedAt: now };
  const result = await db.collection<SessionDoc>("sessions").insertOne(doc);
  return toChatSession({ ...doc, _id: result.insertedId });
}

export async function listSessions(userId: string, limit = 50): Promise<ChatSession[]> {
  const db = await getDb();
  const docs = await db
    .collection<SessionDoc>("sessions")
    .find({ userId: new ObjectId(userId) })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toChatSession);
}

export async function getSessionWithMessages(
  userId: string,
  id: string
): Promise<{
  session: ChatSession;
  messages: StoredMessage[];
  conclusion: SessionConclusion | null;
  recordId: string | null;
} | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const session = await db
    .collection<SessionDoc>("sessions")
    .findOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
  if (!session) return null;
  const docs = await db
    .collection<MessageDoc>("messages")
    .find({ sessionId: new ObjectId(id) })
    .sort({ createdAt: 1 })
    .toArray();
  // Safety net: a server restart kills detached runs, leaving their pending
  // docs orphaned. Anything whose heartbeat went stale is closed here — done
  // when an answer was streamed, failed only when nothing was.
  const cutoff = Date.now() - PENDING_STALE_MS;
  for (const doc of docs) {
    if (doc.status !== "pending") continue;
    if ((doc.updatedAt ?? doc.createdAt).getTime() > cutoff) continue;
    const outcome = stalePendingOutcome(doc);
    const now = new Date();
    await db
      .collection<MessageDoc>("messages")
      .updateOne(
        { _id: doc._id },
        { $set: { status: outcome.status, text: outcome.text, updatedAt: now } }
      );
    doc.status = outcome.status;
    doc.text = outcome.text;
    doc.updatedAt = now;
  }
  return {
    session: toChatSession(session),
    messages: docs.map(toStoredMessage),
    conclusion: session.conclusion ?? null,
    recordId: session.recordId ?? null,
  };
}

export async function setSessionConclusion(
  userId: string,
  id: string,
  conclusion: SessionConclusion | null,
  recordId?: string | null
): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const set: Record<string, unknown> = {
    conclusion: conclusion ?? null,
    updatedAt: new Date(),
  };
  if (recordId !== undefined) set.recordId = recordId ?? null;
  const result = await db
    .collection<SessionDoc>("sessions")
    .updateOne(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: set }
    );
  return result.matchedCount > 0;
}

export async function setSessionRecordId(
  userId: string,
  id: string,
  recordId: string | null
): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const result = await db
    .collection<SessionDoc>("sessions")
    .updateOne(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: { recordId: recordId ?? null, updatedAt: new Date() } }
    );
  return result.matchedCount > 0;
}

// ---- Persistent opencode thread bindings ------------------------------
// One opencode session lives as long as the chat: /api/chat reuses the
// stored id so the model keeps its real memory (tools, files, decisions)
// across turns. Passing null unbinds (revert, poisoned turn, chat deleted).

export async function getAgentBinding(
  userId: string,
  sessionId: string
): Promise<AgentBinding | null> {
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(sessionId)) return null;
  const db = await getDb();
  const doc = await db
    .collection<SessionDoc>("sessions")
    .findOne(
      { _id: new ObjectId(sessionId), userId: new ObjectId(userId) },
      { projection: { opencodeSessionId: 1, opencodePromptTokens: 1, agentSessionId: 1, agentTokens: 1 } }
    );
  const id = doc?.opencodeSessionId || doc?.agentSessionId;
  return id
    ? { sessionId: id, tokens: doc?.opencodePromptTokens ?? doc?.agentTokens ?? 0 }
    : null;
}

export async function listAgentTranscript(
  userId: string,
  sessionId: string
): Promise<ChatMessage[]> {
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(sessionId)) return [];
  const db = await getDb();
  const docs = await db
    .collection<MessageDoc>("messages")
    .find({ sessionId: new ObjectId(sessionId) })
    .sort({ createdAt: 1 })
    .limit(120)
    .toArray();
  const out: ChatMessage[] = [];
  for (const doc of docs) {
    if (doc.status === "pending") continue;
    if (doc.status === "failed" && !(doc.text || "").trim()) continue;
    const text = (doc.text || "").trim();
    const hasImage = (doc.images?.length ?? 0) > 0;
    if (!text && !hasImage) continue;
    out.push({
      role: doc.role,
      text: text || "[photo attached]",
    });
  }
  return out.slice(-80);
}

export async function setAgentBinding(
  userId: string,
  sessionId: string,
  binding: AgentBinding | null
): Promise<void> {
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(sessionId)) return;
  const db = await getDb();
  const filter = { _id: new ObjectId(sessionId), userId: new ObjectId(userId) };
  if (binding) {
    const id = binding.sessionId.slice(0, 64);
    const tokens = Math.max(0, Math.floor(binding.tokens || 0));
    await db.collection<SessionDoc>("sessions").updateOne(filter, {
      $set: {
        opencodeSessionId: id,
        opencodePromptTokens: tokens,
        agentSessionId: id,
        agentTokens: tokens,
      },
    });
  } else {
    await db
      .collection<SessionDoc>("sessions")
      .updateOne(filter, {
        $unset: {
          opencodeSessionId: "",
          opencodePromptTokens: "",
          agentSessionId: "",
          agentTokens: "",
        },
      });
  }
}

export async function appendMessage(
  userId: string,
  sessionId: string,
  input: {
    role: "user" | "model";
    text: string;
    images?: ChatImage[];
    model?: string;
    elapsed?: number;
  }
): Promise<StoredMessage | null> {
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(sessionId)) return null;
  const db = await getDb();
  const now = new Date();
  const owned = await db
    .collection<SessionDoc>("sessions")
    .findOne(
      { _id: new ObjectId(sessionId), userId: new ObjectId(userId) },
      { projection: { _id: 1 } }
    );
  if (!owned) return null;
  const doc: MessageDoc = {
    sessionId: new ObjectId(sessionId),
    role: input.role,
    text: input.text,
    images: input.images,
    model: input.model,
    elapsed: input.elapsed,
    createdAt: now,
  };
  const inserted = await db.collection<MessageDoc>("messages").insertOne(doc);
  const updated = await db
    .collection<SessionDoc>("sessions")
    .updateOne(
      { _id: new ObjectId(sessionId), userId: new ObjectId(userId) },
      { $set: { updatedAt: now } }
    );
  if (updated.matchedCount === 0) {
    await db.collection<MessageDoc>("messages").deleteOne({ _id: inserted.insertedId });
    return null;
  }
  return toStoredMessage({ ...doc, _id: inserted.insertedId });
}

// Create the placeholder model message that an in-flight /api/chat run
// streams into. Returns null when the session is missing / not owned.
export async function startPendingModelMessage(
  userId: string,
  sessionId: string
): Promise<StoredMessage | null> {
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(sessionId)) return null;
  const db = await getDb();
  const session = await db
    .collection<SessionDoc>("sessions")
    .findOne({ _id: new ObjectId(sessionId), userId: new ObjectId(userId) });
  if (!session) return null;
  const now = new Date();
  const doc: MessageDoc = {
    sessionId: new ObjectId(sessionId),
    role: "model",
    text: "",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  const result = await db.collection<MessageDoc>("messages").insertOne(doc);
  await db
    .collection<SessionDoc>("sessions")
    .updateOne({ _id: new ObjectId(sessionId) }, { $set: { updatedAt: now } });
  return toStoredMessage({ ...doc, _id: result.insertedId });
}

// Partial-progress + heartbeat write for a pending run message. Filtered to
// status "pending" so it can never clobber a finalized message.
const MAX_PROCESS_STEPS = 80;
const MAX_PROCESS_STEP_LEN = 180;

function sanitizeProcessSteps(steps: string[] | undefined): string[] | undefined {
  if (!steps?.length) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of steps) {
    if (typeof raw !== "string") continue;
    const clean = raw.replace(/^\s*→\s+/, "").trim().slice(0, MAX_PROCESS_STEP_LEN);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= MAX_PROCESS_STEPS) break;
  }
  return out.length ? out : undefined;
}

export async function updateMessageProgress(
  messageId: string,
  input: { text?: string; model?: string; elapsed?: number; processSteps?: string[] }
): Promise<void> {
  if (!ObjectId.isValid(messageId)) return;
  const db = await getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.text !== undefined) set.text = input.text.slice(0, MAX_MESSAGE_TEXT);
  if (input.model !== undefined) set.model = input.model;
  if (input.elapsed !== undefined) set.elapsed = input.elapsed;
  if (input.processSteps !== undefined) {
    const steps = sanitizeProcessSteps(input.processSteps);
    if (steps) set.processSteps = steps;
  }
  await db
    .collection<MessageDoc>("messages")
    .updateOne({ _id: new ObjectId(messageId), status: "pending" }, { $set: set });
}

export async function finalizeMessage(
  messageId: string,
  input: {
    text: string;
    model?: string;
    elapsed?: number;
    status: "done" | "failed";
    processSteps?: string[];
  }
): Promise<void> {
  if (!ObjectId.isValid(messageId)) return;
  const db = await getDb();
  const set: Record<string, unknown> = {
    status: input.status,
    text: input.text.slice(0, MAX_MESSAGE_TEXT),
    updatedAt: new Date(),
  };
  if (input.model !== undefined) set.model = input.model;
  if (input.elapsed !== undefined) set.elapsed = input.elapsed;
  const steps = sanitizeProcessSteps(input.processSteps);
  if (steps) set.processSteps = steps;
  await db
    .collection<MessageDoc>("messages")
    .updateOne({ _id: new ObjectId(messageId) }, { $set: set });
}

// Client-driven finalize: the browser received a complete answer, so close
// the placeholder even if the handler died before its own finalizeMessage.
// Ownership-checked and filtered to status "pending", so it is idempotent
// against the server-side write and can never revive a failed run. Client
// text only wins when it is longer than the last heartbeat snapshot (the run
// can end between two beats).
export async function finalizePendingMessage(
  userId: string,
  sessionId: string,
  messageId: string,
  input: { text?: string; elapsed?: number }
): Promise<boolean> {
  if (
    !ObjectId.isValid(userId) ||
    !ObjectId.isValid(sessionId) ||
    !ObjectId.isValid(messageId)
  ) {
    return false;
  }
  const db = await getDb();
  const owned = await db
    .collection<SessionDoc>("sessions")
    .findOne(
      { _id: new ObjectId(sessionId), userId: new ObjectId(userId) },
      { projection: { _id: 1 } }
    );
  if (!owned) return false;
  const doc = await db
    .collection<MessageDoc>("messages")
    .findOne(
      { _id: new ObjectId(messageId), sessionId: new ObjectId(sessionId), status: "pending" },
      { projection: { text: 1 } }
    );
  if (!doc) return false;
  const set: Record<string, unknown> = { status: "done", updatedAt: new Date() };
  if (input.elapsed !== undefined) set.elapsed = input.elapsed;
  if (
    typeof input.text === "string" &&
    input.text.trim() &&
    input.text.length > (doc.text?.length ?? 0)
  ) {
    set.text = input.text.slice(0, MAX_MESSAGE_TEXT);
  }
  const result = await db
    .collection<MessageDoc>("messages")
    .updateOne({ _id: doc._id, status: "pending" }, { $set: set });
  return result.matchedCount > 0;
}


const GUEST_SESSION_RE = /^[0-9a-zA-Z-]{8,64}$/;

export function isGuestSessionId(id: string): boolean {
  return GUEST_SESSION_RE.test(id) && !ObjectId.isValid(id);
}

interface GuestRunDoc {
  _id?: ObjectId;
  sessionId: string;
  role: "model";
  text: string;
  status: "pending" | "done" | "failed";
  processSteps?: string[];
  model?: string;
  elapsed?: number;
  createdAt: Date;
  updatedAt: Date;
  /** Persistent opencode thread for this guest chat (survives per-run resets). */
  opencodeSessionId?: string;
  opencodePromptTokens?: number;
  agentSessionId?: string;
  agentTokens?: number;
}

function toGuestRun(doc: GuestRunDoc): StoredMessage {
  return {
    _id: doc._id?.toString() ?? "",
    sessionId: doc.sessionId,
    role: "model",
    text: doc.text,
    model: doc.model,
    elapsed: doc.elapsed,
    createdAt: doc.createdAt.toISOString(),
    status: doc.status,
    updatedAt: doc.updatedAt.toISOString(),
    processSteps: doc.processSteps,
  };
}

// Guest chat ids are UUIDs in localStorage, not owned Mongo sessions.
// Persist the in-flight model message so a hard refresh can rejoin the run.
export async function startGuestPendingRun(sessionId: string): Promise<StoredMessage | null> {
  if (!isGuestSessionId(sessionId)) return null;
  const db = await getDb();
  const now = new Date();
  const col = db.collection<GuestRunDoc>("guestRuns");
  const existing = await col.findOne({ sessionId });
  if (existing) {
    await col.updateOne(
      { _id: existing._id },
      {
        $set: {
          role: "model",
          text: "",
          status: "pending",
          createdAt: now,
          updatedAt: now,
        },
        $unset: { processSteps: "", model: "", elapsed: "" },
      }
    );
    return toGuestRun({
      ...existing,
      role: "model",
      text: "",
      status: "pending",
      processSteps: undefined,
      model: undefined,
      elapsed: undefined,
      createdAt: now,
      updatedAt: now,
    });
  }
  const doc: GuestRunDoc = {
    sessionId,
    role: "model",
    text: "",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  const result = await col.insertOne(doc);
  return toGuestRun({ ...doc, _id: result.insertedId });
}

export async function updateGuestRunProgress(
  sessionId: string,
  input: { text?: string; model?: string; elapsed?: number; processSteps?: string[] }
): Promise<void> {
  if (!isGuestSessionId(sessionId)) return;
  const db = await getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.text !== undefined) set.text = input.text.slice(0, MAX_MESSAGE_TEXT);
  if (input.model !== undefined) set.model = input.model;
  if (input.elapsed !== undefined) set.elapsed = input.elapsed;
  if (input.processSteps !== undefined) {
    const steps = sanitizeProcessSteps(input.processSteps);
    if (steps) set.processSteps = steps;
  }
  await db
    .collection<GuestRunDoc>("guestRuns")
    .updateOne({ sessionId, status: "pending" }, { $set: set });
}

export async function finalizeGuestRun(
  sessionId: string,
  input: {
    text: string;
    model?: string;
    elapsed?: number;
    status: "done" | "failed";
    processSteps?: string[];
  }
): Promise<void> {
  if (!isGuestSessionId(sessionId)) return;
  const db = await getDb();
  const set: Record<string, unknown> = {
    status: input.status,
    text: input.text.slice(0, MAX_MESSAGE_TEXT),
    updatedAt: new Date(),
  };
  if (input.model !== undefined) set.model = input.model;
  if (input.elapsed !== undefined) set.elapsed = input.elapsed;
  const steps = sanitizeProcessSteps(input.processSteps);
  if (steps) set.processSteps = steps;
  await db.collection<GuestRunDoc>("guestRuns").updateOne({ sessionId }, { $set: set });
}

// Client-driven finalize for guest runs: only touches the "pending" doc, so
// it cannot clobber a run the server already closed. Client text only wins
// when it is longer than the last heartbeat snapshot.
export async function finalizePendingGuestRun(
  sessionId: string,
  input: { text?: string; elapsed?: number }
): Promise<boolean> {
  if (!isGuestSessionId(sessionId)) return false;
  const db = await getDb();
  const col = db.collection<GuestRunDoc>("guestRuns");
  const doc = await col.findOne(
    { sessionId, status: "pending" },
    { projection: { text: 1 } }
  );
  if (!doc) return false;
  const set: Record<string, unknown> = { status: "done", updatedAt: new Date() };
  if (input.elapsed !== undefined) set.elapsed = input.elapsed;
  if (
    typeof input.text === "string" &&
    input.text.trim() &&
    input.text.length > (doc.text?.length ?? 0)
  ) {
    set.text = input.text.slice(0, MAX_MESSAGE_TEXT);
  }
  const result = await col.updateOne({ _id: doc._id, status: "pending" }, { $set: set });
  return result.matchedCount > 0;
}

export async function getGuestAgentBinding(
  sessionId: string
): Promise<AgentBinding | null> {
  if (!isGuestSessionId(sessionId)) return null;
  const db = await getDb();
  const doc = await db
    .collection<GuestRunDoc>("guestRuns")
    .findOne(
      { sessionId },
      { projection: { opencodeSessionId: 1, opencodePromptTokens: 1, agentSessionId: 1, agentTokens: 1 } }
    );
  const id = doc?.opencodeSessionId || doc?.agentSessionId;
  return id
    ? { sessionId: id, tokens: doc?.opencodePromptTokens ?? doc?.agentTokens ?? 0 }
    : null;
}

export async function setGuestAgentBinding(
  sessionId: string,
  binding: AgentBinding | null
): Promise<void> {
  if (!isGuestSessionId(sessionId)) return;
  const db = await getDb();
  const col = db.collection<GuestRunDoc>("guestRuns");
  if (binding) {
    // Only bind when a run doc exists (created by startGuestPendingRun during
    // the same send). No doc = non-persisting client; the transcript-dump
    // behavior applies to it anyway, so there is nothing to carry over.
    await col.updateOne(
      { sessionId },
      {
        $set: {
          opencodeSessionId: binding.sessionId.slice(0, 64),
          opencodePromptTokens: Math.max(0, Math.floor(binding.tokens || 0)),
          agentSessionId: binding.sessionId.slice(0, 64),
          agentTokens: Math.max(0, Math.floor(binding.tokens || 0)),
        },
      }
    );
  } else {
    await col.updateOne(
      { sessionId },
      { $unset: { opencodeSessionId: "", opencodePromptTokens: "", agentSessionId: "", agentTokens: "" } }
    );
  }
}

// Clear the binding and hand back the removed opencode session id so the
// caller can dispose of it (guest chat deleted / reverted client-side).
export async function takeGuestAgentBinding(sessionId: string): Promise<string | null> {
  if (!isGuestSessionId(sessionId)) return null;
  const db = await getDb();
  const col = db.collection<GuestRunDoc>("guestRuns");
  const doc = await col.findOne(
    { sessionId },
    { projection: { opencodeSessionId: 1, agentSessionId: 1 } }
  );
  const removed = doc?.opencodeSessionId || doc?.agentSessionId || null;
  await col.updateOne(
    { sessionId },
    { $unset: { opencodeSessionId: "", opencodePromptTokens: "", agentSessionId: "", agentTokens: "" } }
  );
  return removed;
}

export async function getGuestRun(sessionId: string): Promise<StoredMessage | null> {
  if (!isGuestSessionId(sessionId)) return null;
  const db = await getDb();
  const col = db.collection<GuestRunDoc>("guestRuns");
  const doc = await col.findOne({ sessionId });
  if (!doc) return null;
  if (doc.status === "pending") {
    const cutoff = Date.now() - PENDING_STALE_MS;
    if ((doc.updatedAt ?? doc.createdAt).getTime() <= cutoff) {
      const outcome = stalePendingOutcome(doc);
      const now = new Date();
      await col.updateOne(
        { _id: doc._id },
        { $set: { status: outcome.status, text: outcome.text, updatedAt: now } }
      );
      doc.status = outcome.status;
      doc.text = outcome.text;
      doc.updatedAt = now;
    }
  }
  return toGuestRun(doc);
}


// Revert: keep the first `keep` messages of the session, delete the rest.
export async function truncateMessages(
  userId: string,
  sessionId: string,
  keep: number
): Promise<number> {
  if (!ObjectId.isValid(sessionId) || keep < 0) return 0;
  const db = await getDb();
  const session = await db
    .collection<SessionDoc>("sessions")
    .findOne({ _id: new ObjectId(sessionId), userId: new ObjectId(userId) });
  if (!session) return 0;
  const docs = await db
    .collection<MessageDoc>("messages")
    .find({ sessionId: new ObjectId(sessionId) })
    .sort({ createdAt: 1 })
    .toArray();
  const removed = docs.slice(keep);
  if (removed.length === 0) return 0;
  await db
    .collection<MessageDoc>("messages")
    .deleteMany({ _id: { $in: removed.map((doc) => doc._id) } });
  await db
    .collection<SessionDoc>("sessions")
    .updateOne(
      { _id: new ObjectId(sessionId), userId: new ObjectId(userId) },
      {
        $set: { updatedAt: new Date(), conclusion: null },
        // Model memory must not outlive reverted turns: unbind and let the
        // next send re-seed a fresh opencode session from the kept history.
        $unset: { opencodeSessionId: "", opencodePromptTokens: "", agentSessionId: "", agentTokens: "" },
      }
    );
  return removed.length;
}

export async function setSessionTitle(
  userId: string,
  id: string,
  title: string
): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const result = await db
    .collection<SessionDoc>("sessions")
    .updateOne(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: { title, updatedAt: new Date() } }
    );
  return result.matchedCount > 0;
}

export async function setSessionPinned(
  userId: string,
  id: string,
  pinned: boolean
): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const result = await db
    .collection<SessionDoc>("sessions")
    .updateOne(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: { pinned } }
    );
  return result.matchedCount > 0;
}

export async function deleteSession(userId: string, id: string): Promise<boolean> {
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(id)) return false;
  const db = await getDb();
  const result = await db
    .collection<SessionDoc>("sessions")
    .deleteOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
  if (result.deletedCount === 0) return false;
  await db.collection<MessageDoc>("messages").deleteMany({
    sessionId: new ObjectId(id),
  });
  return true;
}

interface ShareDoc {
  _id?: ObjectId;
  token: string;
  kind: "chat" | "message";
  title: string;
  messages: {
    role: "user" | "model";
    text: string;
    image?: ChatImage;
    model?: string;
    elapsed?: number;
  }[];
  createdAt: Date;
}

export interface SharedContent {
  kind: "chat" | "message";
  title: string;
  messages: ShareDoc["messages"];
  createdAt: string;
}

function toSharedContent(doc: ShareDoc): SharedContent {
  return {
    kind: doc.kind,
    title: doc.title,
    messages: doc.messages,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function insertShare(input: {
  kind: "chat" | "message";
  title: string;
  messages: ShareDoc["messages"];
}): Promise<string> {
  const db = await getDb();
  const token = randomBytes(9).toString("base64url");
  const doc: ShareDoc = { ...input, token, createdAt: new Date() };
  await db.collection<ShareDoc>("shares").insertOne(doc);
  return token;
}

export async function getShare(token: string): Promise<SharedContent | null> {
  const db = await getDb();
  const doc = await db.collection<ShareDoc>("shares").findOne({ token });
  return doc ? toSharedContent(doc) : null;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface SearchHit {
  sessionId: string;
  title: string;
  snippet: string;
  matches: number;
  updatedAt: string;
  messageId?: string;
}

// Full-history search: match message text, group by session, return a
// snippet around the first match.
export async function searchChats(
  userId: string,
  q: string,
  limit = 20
): Promise<SearchHit[]> {
  if (!ObjectId.isValid(userId)) return [];
  const db = await getDb();
  const owned = await db
    .collection<SessionDoc>("sessions")
    .find({ userId: new ObjectId(userId) })
    .project({ _id: 1, title: 1, updatedAt: 1 })
    .toArray();
  const ids = owned
    .map((session) => session._id)
    .filter((id): id is ObjectId => Boolean(id));
  if (ids.length === 0) return [];
  const regex = new RegExp(escapeRegex(q), "i");
  const grouped = await db
    .collection<MessageDoc>("messages")
    .aggregate<{ _id: ObjectId; count: number; first: MessageDoc }>([
      { $match: { sessionId: { $in: ids }, text: regex } },
      { $group: { _id: "$sessionId", count: { $sum: 1 }, first: { $first: "$$ROOT" } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ])
    .toArray();
  const byId = new Map(owned.map((s) => [s._id!.toString(), s]));
  return grouped.flatMap((row) => {
    const sid = row._id.toString();
    const session = byId.get(sid);
    if (!session) return [];
    const text = String(row.first.text ?? "");
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    const start = Math.max(0, idx - 12);
    const snippet =
      (start > 0 ? "…" : "") + text.slice(start, start + 100).replace(/\s+/g, " ");
    return [
      {
        sessionId: sid,
        title: session.title,
        snippet,
        matches: row.count,
        updatedAt: session.updatedAt.toISOString(),
        messageId: row.first._id?.toString(),
      },
    ];
  });
}
