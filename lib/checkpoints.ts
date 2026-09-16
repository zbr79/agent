import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ObjectId } from "mongodb";
import { getDb } from "./db";
import { assertAllowedAgentFile } from "./pathJail";
import { workspaceRoot } from "./workspaces";
import type { WorkspaceId } from "./types";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const CHECKPOINT_ROOT =
  process.env.AGENT_CHECKPOINT_DIR?.trim() ||
  path.join(path.dirname(process.env.AGENT_WORKSPACE || "/home/ubuntu/agent"), ".agent-checkpoints");
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

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

interface WorkspaceFile {
  path: string;
  absolute: string;
  data: Buffer;
  hash: string;
  size: number;
  mode: number;
}

interface WorkspaceFileMeta {
  path: string;
  absolute: string;
  hash: string;
  size: number;
  mode: number;
}

function checkpointDir(id: string): string {
  return path.join(CHECKPOINT_ROOT, id);
}

function fileArtifactPath(id: string, artifact: string): string {
  return path.join(checkpointDir(id), "files", artifact);
}

function hashBuffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hashPath(relativePath: string): string {
  return createHash("sha256").update(relativePath).digest("hex");
}

function isExcluded(relativePath: string): boolean {
  if (relativePath.split(path.sep).some((segment) => EXCLUDED_SEGMENTS.has(segment))) {
    return true;
  }
  const base = path.basename(relativePath);
  return (
    base === ".server-env" ||
    base.startsWith(".env") ||
    base === "id_rsa" ||
    base === "id_ed25519" ||
    base === "id_ecdsa" ||
    base === "id_dsa" ||
    base.endsWith("_rsa") ||
    base.endsWith("_ed25519") ||
    /\.pem$/i.test(base) ||
    /\.ppk$/i.test(base) ||
    (/\.key$/i.test(base) && base !== "package-lock.json")
  );
}

function runGitFiles(root: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["ls-files", "-co", "--exclude-standard", "-z"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: false }
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || "Could not enumerate workspace files."));
        return;
      }
      resolve(
        Buffer.concat(chunks)
          .toString("utf8")
          .split("\0")
          .filter(Boolean)
      );
    });
  });
}

async function listWorkspacePaths(workspaceId: WorkspaceId, root: string): Promise<string[]> {
  const paths = await runGitFiles(root);
  const safe: string[] = [];
  for (const relativePath of paths) {
    if (isExcluded(relativePath)) continue;
    const absolute = assertAllowedAgentFile(relativePath, root);
    const stat = await fs.promises.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    safe.push(relativePath);
  }
  if (!safe.length && workspaceId) {
    // The workspace may be a valid, empty Git repository.
    return [];
  }
  return safe;
}

async function readWorkspaceFile(
  relativePath: string,
  root: string,
  includeData: boolean
): Promise<WorkspaceFile | WorkspaceFileMeta | null> {
  if (isExcluded(relativePath)) return null;
  const absolute = assertAllowedAgentFile(relativePath, root);
  const before = await fs.promises.lstat(absolute);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_FILE_BYTES) {
    return null;
  }
  const data = await fs.promises.readFile(absolute);
  const after = await fs.promises.lstat(absolute);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs
  ) {
    throw new Error(`Workspace file changed while checkpointing: ${relativePath}`);
  }
  const base = {
    path: relativePath,
    absolute,
    hash: hashBuffer(data),
    size: data.byteLength,
    mode: before.mode & 0o777,
  };
  return includeData ? { ...base, data } : base;
}

async function captureWorkspace(
  workspaceId: WorkspaceId,
  root: string,
  includeData: boolean
): Promise<(WorkspaceFile | WorkspaceFileMeta)[]> {
  const paths = await listWorkspacePaths(workspaceId, root);
  const files: (WorkspaceFile | WorkspaceFileMeta)[] = [];
  for (const relativePath of paths) {
    const file = await readWorkspaceFile(relativePath, root, includeData);
    if (file) files.push(file);
  }
  return files;
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
    const captured = await captureWorkspace(input.workspaceId, root, true) as WorkspaceFile[];
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
  const current = await captureWorkspace(doc.workspaceId, root, false) as WorkspaceFileMeta[];
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

async function currentFileHash(
  root: string,
  relativePath: string
): Promise<string | null> {
  try {
    const file = await readWorkspaceFile(relativePath, root, false);
    return file?.hash ?? null;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
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

export async function restoreCheckpoint(
  userId: string,
  checkpointId: string
): Promise<{ preview: CheckpointPreview; safety: CheckpointInfo | null } | null> {
  const doc = await ownedCheckpoint(userId, checkpointId);
  if (!doc || doc.status !== "ready") return null;
  const preview = await getCheckpointPreview(userId, checkpointId);
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
  const entries = new Map(doc.files.map((file) => [file.path, file]));
  for (const change of doc.changes) {
    const absolute = assertAllowedAgentFile(change.path, root);
    const before = entries.get(change.path);
    if (before) {
      const data = await fs.promises.readFile(fileArtifactPath(checkpointId, before.artifact));
      await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
      await fs.promises.writeFile(absolute, data, { mode: before.mode });
      await fs.promises.chmod(absolute, before.mode);
    } else {
      await fs.promises.rm(absolute, { force: true });
    }
  }
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
