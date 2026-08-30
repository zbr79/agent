import { Db, MongoClient, ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import type {
  ApiCall,
  ChatImage,
  ChatSession,
  ConcludeItem,
  ConcludeMeal,
  SavedRecord,
  SessionConclusion,
  StoredMessage,
} from "./types";

const DB_NAME = process.env.MONGODB_DB || "inschat";

interface RecordDoc {
  _id?: ObjectId;
  userId?: ObjectId;
  title: string;
  summary: string;
  items: ConcludeItem[];
  meals?: ConcludeMeal[];
  sourceText?: string;
  savedAt: Date;
  datetime: Date | null;
}

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

export function toSavedRecord(doc: RecordDoc): SavedRecord {
  return {
    _id: doc._id?.toString() ?? "",
    title: doc.title,
    summary: doc.summary,
    items: doc.items,
    meals: doc.meals,
    sourceText: doc.sourceText,
    savedAt: doc.savedAt.toISOString(),
    datetime: doc.datetime ? doc.datetime.toISOString() : null,
  };
}

export async function insertRecord(
  userId: string,
  input: {
    title: string;
    summary: string;
    items: ConcludeItem[];
    meals?: ConcludeMeal[];
    sourceText?: string;
    datetime: Date | null;
  }
): Promise<SavedRecord> {
  const db = await getDb();
  const doc: RecordDoc = { ...input, userId: new ObjectId(userId), savedAt: new Date() };
  const result = await db.collection<RecordDoc>("records").insertOne(doc);
  return toSavedRecord({ ...doc, _id: result.insertedId });
}

export async function listRecords(userId: string, limit = 100): Promise<SavedRecord[]> {
  const db = await getDb();
  const docs = await db
    .collection<RecordDoc>("records")
    .find({ userId: new ObjectId(userId) })
    .sort({ savedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toSavedRecord);
}

export async function deleteRecord(userId: string, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const result = await db
    .collection<RecordDoc>("records")
    .deleteOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
  return result.deletedCount > 0;
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
  conclusion?: SessionConclusion | null;
}

interface MessageDoc {
  _id?: ObjectId;
  sessionId: ObjectId;
  role: "user" | "model";
  text: string;
  image?: ChatImage;
  model?: string;
  elapsed?: number;
  createdAt: Date;
}

function toChatSession(doc: SessionDoc): ChatSession {
  return {
    _id: doc._id?.toString() ?? "",
    title: doc.title,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toStoredMessage(doc: MessageDoc): StoredMessage {
  return {
    _id: doc._id?.toString() ?? "",
    sessionId: doc.sessionId.toString(),
    role: doc.role,
    text: doc.text,
    image: doc.image,
    model: doc.model,
    elapsed: doc.elapsed,
    createdAt: doc.createdAt.toISOString(),
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
  return {
    session: toChatSession(session),
    messages: docs.map(toStoredMessage),
    conclusion: session.conclusion ?? null,
  };
}

export async function setSessionConclusion(
  userId: string,
  id: string,
  conclusion: SessionConclusion | null
): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const result = await db
    .collection<SessionDoc>("sessions")
    .updateOne(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: { conclusion: conclusion ?? null, updatedAt: new Date() } }
    );
  return result.matchedCount > 0;
}

export async function appendMessage(
  userId: string,
  sessionId: string,
  input: {
    role: "user" | "model";
    text: string;
    image?: ChatImage;
    model?: string;
    elapsed?: number;
  }
): Promise<StoredMessage | null> {
  if (!ObjectId.isValid(sessionId)) return null;
  const db = await getDb();
  const now = new Date();
  const doc: MessageDoc = {
    sessionId: new ObjectId(sessionId),
    role: input.role,
    text: input.text,
    image: input.image,
    model: input.model,
    elapsed: input.elapsed,
    createdAt: now,
  };
  await db.collection<MessageDoc>("messages").insertOne(doc);
  const updated = await db
    .collection<SessionDoc>("sessions")
    .updateOne(
      { _id: new ObjectId(sessionId), userId: new ObjectId(userId) },
      { $set: { updatedAt: now } }
    );
  if (updated.matchedCount === 0) return null;
  return toStoredMessage(doc);
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
      { $set: { updatedAt: new Date(), conclusion: null } }
    );
  return removed.length;
}

export async function deleteSession(userId: string, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  await db.collection<MessageDoc>("messages").deleteMany({
    sessionId: new ObjectId(id),
  });
  const result = await db
    .collection<SessionDoc>("sessions")
    .deleteOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
  return result.deletedCount > 0;
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
