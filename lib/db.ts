import { Db, MongoClient, ObjectId } from "mongodb";
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
  kind: "chat" | "conclude" | "health";
  model: string;
  ok: boolean;
  error?: string;
  at: Date;
}

export function toApiCall(doc: CallDoc): ApiCall {
  return {
    _id: doc._id?.toString() ?? "",
    kind: doc.kind,
    model: doc.model,
    ok: doc.ok,
    error: doc.error,
    at: doc.at.toISOString(),
  };
}

export async function insertCall(input: {
  kind: "chat" | "conclude" | "health";
  model: string;
  ok: boolean;
  error?: string;
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
