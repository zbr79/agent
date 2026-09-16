import fs from "node:fs";
import path from "node:path";
import { ObjectId } from "mongodb";
import { getDb } from "./db";
import { workspaceRoot } from "./workspaces";
import type { WorkspaceId } from "./types";
import {
  applySnapshotToRoot,
  captureSnapshot,
  currentFileHash,
  hashPath,
  type SnapshotFile,
  type SnapshotFileMeta,
} from "./checkpointSnapshot";

const CHECKPOINT_ROOT =
  process.env.AGENT_CHECKPOINT_DIR?.trim() ||
  path.join(path.dirname(process.env.AGENT_WORKSPACE || "/home/ubuntu/agent"), ".agent-checkpoints");

export type CheckpointStatus = "captured" | "ready" | "failed";
export type CheckpointKind = "run" | "recovery";

export interface CheckpointInfo {
  id: string;
  workspaceId: WorkspaceId;
  sessionId?: string;
  messageId?: string;
  reason: string;
  kind: CheckpointKind;
  status: CheckpointStatus;
  createdAt: string;
  changedCount: number;
}

export interface RestoreChange {
  path: string;
  kind: "modified" | "created" | "deleted";
  currentHash: string | null;
  expectedHash: string | null;
  conflict: boolean;
}

export interface CheckpointPreview {
  checkpoint: CheckpointInfo;
  changes: RestoreChange[];
  conflicts: RestoreChange[];
}

interface FileEntry {
  path: string;
  hash: string;
  size: number;
  mode: number;
  artifact: string;
}

interface ChangeEntry {
  path: string;
  kind: RestoreChange["kind"];
  afterHash: string | null;
}

interface CheckpointDoc {
  _id: ObjectId;
  userId: ObjectId;
  workspaceId: WorkspaceId;
  sessionId?: string;
  messageId?: string;
  reason: string;
  kind: CheckpointKind;
  status: CheckpointStatus;
  createdAt: Date;
  updatedAt: Date;
  files: FileEntry[];
  changes: ChangeEntry[];
}

function checkpointDir(id: string): string {
  return path.join(CHECKPOINT_ROOT, id);
}

function fileArtifactPath(id: string, artifact: string): string {
  return path.join(checkpointDir(id), "files", artifact);
}

function toInfo(doc: CheckpointDoc): CheckpointInfo {
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId,
    sessionId: doc.sessionId,
    messageId: doc.messageId,
    reason: doc.reason,
    kind: doc.kind,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    changedCount: doc.changes.length,
  };
}

async function ownedCheckpoint(userId: string, checkpointId: string): Promise<CheckpointDoc | null> {
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(checkpointId)) return null;
  const db = await getDb();
  return db.collection<CheckpointDoc>("checkpoints").findOne({
    _id: new ObjectId(checkpointId),
    userId: new ObjectId(userId),
  });
}

export async function createCheckpoint(input: {
  userId: string;
  workspaceId: WorkspaceId;
  sessionId?: string;
  messageId?: string;
  reason: string;
  kind?: CheckpointKind;
}): Promise<CheckpointInfo> {
  if (!ObjectId.isValid(input.userId)) throw new Error("Invalid checkpoint owner.");
  const root = workspaceRoot(input.workspaceId);
  const id = new ObjectId();
  const kind = input.kind ?? "run";
  const reason = input.reason.trim().slice(0, 160) || "Before agent run";
  const artifactDir = path.join(checkpointDir(id.toString()), "files");
  const now = new Date();
  await fs.promises.mkdir(artifactDir, { recursive: true, mode: 0o700 });
  try {
    const captured = (await captureSnapshot(root, true)) as SnapshotFile[];
    const files: FileEntry[] = [];
    for (const file of captured) {
      const artifact = hashPath(file.path);
      await fs.promises.writeFile(fileArtifactPath(id.toString(), artifact), file.data, {
        mode: 0o600,
      });
      files.push({
        path: file.path,
        hash: file.hash,
        size: file.size,
        mode: file.mode,
        artifact,
      });
    }
    const changes: ChangeEntry[] =
      kind === "recovery"
        ? files.map((file) => ({
            path: file.path,
            kind: "modified",
            afterHash: file.hash,
          }))
        : [];
    const doc: CheckpointDoc = {
      _id: id,
      userId: new ObjectId(input.userId),
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      reason,
      kind,
      status: kind === "recovery" ? "ready" : "captured",
      createdAt: now,
      updatedAt: now,
      files,
      changes,
    };
    const db = await getDb();
    await db.collection<CheckpointDoc>("checkpoints").insertOne(doc);
    return toInfo(doc);
  } catch (error) {
    await fs.promises.rm(checkpointDir(id.toString()), { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function finalizeCheckpoint(
  userId: string,
  checkpointId: string
): Promise<CheckpointInfo | null> {
  const doc = await ownedCheckpoint(userId, checkpointId);
  if (!doc) return null;
  const root = workspaceRoot(doc.workspaceId);
  const current = (await captureSnapshot(root, false)) as SnapshotFileMeta[];
  const before = new Map(doc.files.map((file) => [file.path, file]));
  const after = new Map(current.map((file) => [file.path, file]));
  const paths = new Set([...before.keys(), ...after.keys()]);
  const changes: ChangeEntry[] = [];
  for (const relativePath of paths) {
    const oldFile = before.get(relativePath);
    const newFile = after.get(relativePath);
    if (
      oldFile &&
      newFile &&
      oldFile.hash === newFile.hash &&
      oldFile.mode === newFile.mode
    ) {
      continue;
    }
    changes.push({
      path: relativePath,
      kind: oldFile ? (newFile ? "modified" : "deleted") : "created",
      afterHash: newFile?.hash ?? null,
    });
  }
  const db = await getDb();
  await db.collection<CheckpointDoc>("checkpoints").updateOne(
    { _id: doc._id, userId: new ObjectId(userId) },
    { $set: { changes, status: "ready", updatedAt: new Date() } }
  );
  return toInfo({ ...doc, changes, status: "ready", updatedAt: new Date() });
}

export async function listCheckpoints(
  userId: string,
  workspaceId: WorkspaceId,
  messageId?: string
): Promise<CheckpointInfo[]> {
  if (!ObjectId.isValid(userId)) return [];
  const db = await getDb();
  const docs = await db
    .collection<CheckpointDoc>("checkpoints")
    .find({
      userId: new ObjectId(userId),
      workspaceId,
      status: "ready",
      ...(messageId ? { messageId } : {}),
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  return docs.map(toInfo);
}

export async function getCheckpointPreview(
  userId: string,
  checkpointId: string
): Promise<CheckpointPreview | null> {
  const doc = await ownedCheckpoint(userId, checkpointId);
  if (!doc || doc.status !== "ready") return null;
  const root = workspaceRoot(doc.workspaceId);
  const changes: RestoreChange[] = [];
  for (const change of doc.changes) {
    const currentHash = await currentFileHash(root, change.path);
    changes.push({
      path: change.path,
      kind: change.kind,
      currentHash,
      expectedHash: change.afterHash,
      // A created file that is already absent is the desired pre-run state.
      // Treat restore retries as idempotent instead of reporting a conflict.
      conflict:
        !(change.kind === "created" && currentHash === null) &&
        currentHash !== change.afterHash,
    });
  }
  return {
    checkpoint: toInfo(doc),
    changes,
    conflicts: changes.filter((change) => change.conflict),
  };
}

export class CheckpointConflictError extends Error {
  preview: CheckpointPreview;
  constructor(preview: CheckpointPreview, message?: string) {
    super(message || "This run has newer file changes. Resolve them before editing the prompt.");
    this.name = "CheckpointConflictError";
    this.preview = preview;
  }
}

export async function listRunCheckpoints(
  userId: string,
  workspaceId: WorkspaceId,
  sessionId: string
): Promise<CheckpointInfo[]> {
  if (!ObjectId.isValid(userId) || !sessionId) return [];
  const db = await getDb();
  const docs = await db
    .collection<CheckpointDoc>("checkpoints")
    .find({
      userId: new ObjectId(userId),
      workspaceId,
      sessionId,
      kind: "run",
      status: "ready",
    })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  return docs.map(toInfo);
}

export async function latestSessionRunCheckpoint(
  userId: string,
  workspaceId: WorkspaceId,
  sessionId: string
): Promise<CheckpointInfo | null> {
  return (await listRunCheckpoints(userId, workspaceId, sessionId))[0] ?? null;
}

export async function findRunCheckpointForMessage(
  userId: string,
  workspaceId: WorkspaceId,
  messageId: string,
  sessionId?: string
): Promise<CheckpointInfo | null> {
  if (!ObjectId.isValid(userId) || !messageId) return null;
  const db = await getDb();
  const doc = await db.collection<CheckpointDoc>("checkpoints").findOne(
    {
      userId: new ObjectId(userId),
      workspaceId,
      messageId,
      kind: "run",
      status: "ready",
      ...(sessionId ? { sessionId } : {}),
    },
    { sort: { createdAt: -1 } }
  );
  return doc ? toInfo(doc) : null;
}

export async function deleteCheckpointsForMessages(
  userId: string,
  sessionId: string,
  messageIds: string[]
): Promise<number> {
  if (!ObjectId.isValid(userId) || !sessionId || messageIds.length === 0) return 0;
  const db = await getDb();
  const docs = await db
    .collection<CheckpointDoc>("checkpoints")
    .find({
      userId: new ObjectId(userId),
      sessionId,
      kind: "run",
      messageId: { $in: messageIds },
    })
    .toArray();
  if (!docs.length) return 0;
  const result = await db.collection<CheckpointDoc>("checkpoints").deleteMany({
    _id: { $in: docs.map((doc) => doc._id) },
  });
  await Promise.all(
    docs.map((doc) =>
      fs.promises.rm(checkpointDir(doc._id.toString()), { recursive: true, force: true })
    )
  );
  return result.deletedCount ?? 0;
}

export async function getRestoreConflictPreview(
  userId: string,
  checkpointId: string
): Promise<CheckpointPreview | null> {
  const doc = await ownedCheckpoint(userId, checkpointId);
  if (!doc || doc.status !== "ready") return null;
  if (doc.sessionId) {
    const latest = await latestSessionRunCheckpoint(userId, doc.workspaceId, doc.sessionId);
    if (latest) return getCheckpointPreview(userId, latest.id);
  }
  return getCheckpointPreview(userId, checkpointId);
}

async function snapshotFilesFromDoc(doc: CheckpointDoc): Promise<SnapshotFile[]> {
  const checkpointId = doc._id.toString();
  const files: SnapshotFile[] = [];
  for (const file of doc.files) {
    const data = await fs.promises.readFile(fileArtifactPath(checkpointId, file.artifact));
    files.push({
      path: file.path,
      hash: file.hash,
      size: file.size,
      mode: file.mode,
      data,
    });
  }
  return files;
}

export async function restoreCheckpoint(
  userId: string,
  checkpointId: string
): Promise<{ preview: CheckpointPreview; safety: CheckpointInfo | null } | null> {
  const doc = await ownedCheckpoint(userId, checkpointId);
  if (!doc || doc.status !== "ready") return null;
  const preview = await getRestoreConflictPreview(userId, checkpointId);
  if (!preview) return null;
  if (preview.conflicts.length) return { preview, safety: null };

  const safety = await createCheckpoint({
    userId,
    workspaceId: doc.workspaceId,
    sessionId: doc.sessionId,
    reason: `Before restoring ${checkpointId}`,
    kind: "recovery",
  });
  const root = workspaceRoot(doc.workspaceId);
  await applySnapshotToRoot(root, await snapshotFilesFromDoc(doc));
  const db = await getDb();
  await db.collection<CheckpointDoc>("checkpoints").updateOne(
    { _id: new ObjectId(checkpointId), userId: new ObjectId(userId) },
    { $set: { status: "ready", updatedAt: new Date() } }
  );
  return { preview, safety };
}

export async function deleteCheckpoint(userId: string, checkpointId: string): Promise<boolean> {
  const doc = await ownedCheckpoint(userId, checkpointId);
  if (!doc) return false;
  const db = await getDb();
  const result = await db.collection<CheckpointDoc>("checkpoints").deleteOne({ _id: doc._id });
  if (result.deletedCount) {
    await fs.promises.rm(checkpointDir(checkpointId), { recursive: true, force: true });
  }
  return result.deletedCount > 0;
}
