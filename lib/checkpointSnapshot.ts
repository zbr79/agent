import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertAllowedAgentFile } from "./pathJail";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export interface SnapshotFile {
  path: string;
  hash: string;
  size: number;
  mode: number;
  data: Buffer;
}

export interface SnapshotFileMeta {
  path: string;
  hash: string;
  size: number;
  mode: number;
}

export function hashBuffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hashPath(relativePath: string): string {
  return createHash("sha256").update(relativePath).digest("hex");
}

export function isExcluded(relativePath: string): boolean {
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

function isEnoent(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
  );
}

export async function listSnapshotPaths(root: string): Promise<string[]> {
  const paths = await runGitFiles(root);
  const safe: string[] = [];
  for (const relativePath of paths) {
    if (isExcluded(relativePath)) continue;
    const absolute = assertAllowedAgentFile(relativePath, root);
    let stat;
    try {
      stat = await fs.promises.lstat(absolute);
    } catch (error) {
      // git ls-files -c still lists tracked files after they are deleted from
      // disk. Skip them so an uncommitted delete cannot abort a Build run.
      if (isEnoent(error)) continue;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    safe.push(relativePath);
  }
  return safe;
}

export async function readSnapshotFile(
  relativePath: string,
  root: string,
  includeData: boolean
): Promise<(SnapshotFile | SnapshotFileMeta) | null> {
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
    hash: hashBuffer(data),
    size: data.byteLength,
    mode: before.mode & 0o777,
  };
  return includeData ? { ...base, data } : base;
}

export async function captureSnapshot(
  root: string,
  includeData: boolean
): Promise<(SnapshotFile | SnapshotFileMeta)[]> {
  const paths = await listSnapshotPaths(root);
  const files: (SnapshotFile | SnapshotFileMeta)[] = [];
  for (const relativePath of paths) {
    const file = await readSnapshotFile(relativePath, root, includeData);
    if (file) files.push(file);
  }
  return files;
}

export async function currentFileHash(
  root: string,
  relativePath: string
): Promise<string | null> {
  try {
    const file = await readSnapshotFile(relativePath, root, false);
    return file?.hash ?? null;
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

export async function applySnapshotToRoot(
  root: string,
  files: SnapshotFile[]
): Promise<{ written: number; deleted: number }> {
  const snapshot = new Map(files.map((file) => [file.path, file]));
  const currentPaths = await listSnapshotPaths(root);
  let written = 0;
  let deleted = 0;
  for (const file of files) {
    const absolute = assertAllowedAgentFile(file.path, root);
    const existingHash = await currentFileHash(root, file.path);
    if (existingHash === file.hash) continue;
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, file.data, { mode: file.mode });
    await fs.promises.chmod(absolute, file.mode);
    written += 1;
  }
  for (const relativePath of currentPaths) {
    if (snapshot.has(relativePath)) continue;
    const absolute = assertAllowedAgentFile(relativePath, root);
    await fs.promises.rm(absolute, { force: true });
    deleted += 1;
  }
  return { written, deleted };
}
