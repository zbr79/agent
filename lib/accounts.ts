import { ObjectId } from "mongodb";
import { getDb } from "./db";

export interface UserDoc {
  _id?: ObjectId;
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: Date;
}

interface AuthTokenDoc {
  _id?: ObjectId;
  tokenHash: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

export async function findUserByUsername(username: string): Promise<UserDoc | null> {
  const db = await getDb();
  return db.collection<UserDoc>("users").findOne({ username });
}

export async function insertUser(input: {
  username: string;
  passwordHash: string;
  salt: string;
}): Promise<UserDoc> {
  const db = await getDb();
  const doc: UserDoc = { ...input, createdAt: new Date() };
  const result = await db.collection<UserDoc>("users").insertOne(doc);
  const user: UserDoc = { ...doc, _id: result.insertedId };
  // The first user claims all pre-account data (sessions/messages/records),
  // including docs whose userId points at a deleted user.
  if ((await db.collection<UserDoc>("users").countDocuments()) === 1) {
    const userId = user._id as ObjectId;
    const valid = (await db.collection<UserDoc>("users").find({}).project({ _id: 1 }).toArray())
      .map((u) => u._id)
      .filter((id): id is ObjectId => Boolean(id));
    const owned = {
      $or: [{ userId: { $exists: false } }, { userId: { $nin: valid } }],
    };
    for (const name of ["sessions", "messages", "records"]) {
      await db.collection(name).updateMany(owned, { $set: { userId } });
    }
  }
  return user;
}

export async function insertAuthToken(input: {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}): Promise<void> {
  const db = await getDb();
  const doc: AuthTokenDoc = {
    tokenHash: input.tokenHash,
    userId: new ObjectId(input.userId),
    createdAt: new Date(),
    expiresAt: input.expiresAt,
  };
  await db.collection<AuthTokenDoc>("auth_tokens").insertOne(doc);
}

export async function findUserByTokenHash(tokenHash: string): Promise<UserDoc | null> {
  const db = await getDb();
  const token = await db
    .collection<AuthTokenDoc>("auth_tokens")
    .findOne({ tokenHash, expiresAt: { $gt: new Date() } });
  if (!token) return null;
  return db.collection<UserDoc>("users").findOne({ _id: token.userId });
}

export async function deleteAuthToken(tokenHash: string): Promise<void> {
  const db = await getDb();
  await db.collection<AuthTokenDoc>("auth_tokens").deleteOne({ tokenHash });
}
