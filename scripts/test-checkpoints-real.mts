#!/usr/bin/env node
/**
 * Realistic multi-turn rewind + live workspace probe.
 * Run: npx tsx scripts/test-checkpoints-real.mts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  applySnapshotToRoot,
  captureSnapshot,
  currentFileHash,
  hashBuffer,
  hashPath,
  type SnapshotFile,
} from "../lib/checkpointSnapshot.ts";

const exec = promisify(execFile);
const AGENT_ROOT = "/home/ubuntu/agent";

function conflictForChange(
  kind: "modified" | "created" | "deleted",
  currentHash: string | null,
  afterHash: string | null
): boolean {
  return !(kind === "created" && currentHash === null) && currentHash !== afterHash;
}

async function git(root: string, ...args: string[]) {
  return exec("git", args, { cwd: root, encoding: "utf8" });
}

async function writeFile(root: string, relative: string, contents: string) {
  const absolute = path.join(root, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents);
}

async function exists(root: string, relative: string) {
  try {
    await fs.access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function snap(root: string): Promise<SnapshotFile[]> {
  return (await captureSnapshot(root, true)) as SnapshotFile[];
}

function changesBetween(before: SnapshotFile[], after: SnapshotFile[]) {
  const oldFiles = new Map(before.map((file) => [file.path, file]));
  const newFiles = new Map(after.map((file) => [file.path, file]));
  const paths = new Set([...oldFiles.keys(), ...newFiles.keys()]);
  const changes: { path: string; kind: "modified" | "created" | "deleted"; afterHash: string | null }[] = [];
  for (const relative of paths) {
    const oldFile = oldFiles.get(relative);
    const newFile = newFiles.get(relative);
    if (oldFile && newFile && oldFile.hash === newFile.hash && oldFile.mode === newFile.mode) {
      continue;
    }
    changes.push({
      path: relative,
      kind: oldFile ? (newFile ? "modified" : "deleted") : "created",
      afterHash: newFile?.hash ?? null,
    });
  }
  return changes;
}

async function latestConflicts(
  root: string,
  changes: { path: string; kind: "modified" | "created" | "deleted"; afterHash: string | null }[]
) {
  const conflicts = [];
  for (const change of changes) {
    const currentHash = await currentFileHash(root, change.path);
    if (conflictForChange(change.kind, currentHash, change.afterHash)) {
      conflicts.push({ ...change, currentHash });
    }
  }
  return conflicts;
}

let failed = 0;
async function check(name: string, callback: () => Promise<void> | void) {
  try {
    await callback();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}: ${(error as Error).message}`);
  }
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rewind-real-"));

try {
  await git(tmp, "init", "-b", "main");
  await git(tmp, "config", "user.name", "Rewind test");
  await git(tmp, "config", "user.email", "rewind-test@example.invalid");
  await writeFile(tmp, "a.txt", "A0\n");
  await writeFile(tmp, "nested/x.txt", "X0\n");
  await git(tmp, "add", "a.txt", "nested/x.txt");
  await git(tmp, "commit", "-m", "start");

  const c1 = await snap(tmp); // before run 1
  await writeFile(tmp, "a.txt", "A1\n");
  await writeFile(tmp, "b.txt", "B\n");
  const after1 = await snap(tmp);

  const c2 = after1; // before run 2
  await writeFile(tmp, "nested/x.txt", "X2\n");
  const after2 = await snap(tmp);

  const c3 = after2; // before run 3
  await fs.rm(path.join(tmp, "b.txt"));
  const after3 = await snap(tmp);

  const c4 = after3; // before run 4
  await writeFile(tmp, "c.txt", "C\n");
  const after4 = await snap(tmp);

  const c5 = after4; // before run 5
  await writeFile(tmp, "a.txt", "A5\n");
  const after5 = await snap(tmp);
  const latestChanges = changesBetween(c5, after5);

  await applySnapshotToRoot(tmp, c1);
  await check("jump back 5 runs restores A0/X0 and drops later files", async () => {
    assert.equal(await fs.readFile(path.join(tmp, "a.txt"), "utf8"), "A0\n");
    assert.equal(await fs.readFile(path.join(tmp, "nested/x.txt"), "utf8"), "X0\n");
    assert.equal(await exists(tmp, "b.txt"), false);
    assert.equal(await exists(tmp, "c.txt"), false);
  });

  await applySnapshotToRoot(tmp, after5);
  await applySnapshotToRoot(tmp, c3);
  await check("jump back 3 runs keeps A1/X2/B, drops C and A5", async () => {
    assert.equal(await fs.readFile(path.join(tmp, "a.txt"), "utf8"), "A1\n");
    assert.equal(await fs.readFile(path.join(tmp, "nested/x.txt"), "utf8"), "X2\n");
    assert.equal(await fs.readFile(path.join(tmp, "b.txt"), "utf8"), "B\n");
    assert.equal(await exists(tmp, "c.txt"), false);
  });

  await applySnapshotToRoot(tmp, after5);
  const cleanConflicts = await latestConflicts(tmp, latestChanges);
  await check("disk matching last run has no conflicts", () => {
    assert.equal(cleanConflicts.length, 0);
  });

  await writeFile(tmp, "a.txt", "A6-hand-edit\n");
  const dirtyConflicts = await latestConflicts(tmp, latestChanges);
  await check("hand-edit after last run conflicts on a.txt", () => {
    assert.ok(dirtyConflicts.some((change) => change.path === "a.txt"));
  });

  const artifactDir = path.join(tmp, ".artifacts");
  await fs.mkdir(artifactDir);
  for (const file of c1) {
    await fs.writeFile(path.join(artifactDir, hashPath(file.path)), file.data);
  }
  const fromArtifacts: SnapshotFile[] = [];
  for (const file of c1) {
    const data = await fs.readFile(path.join(artifactDir, hashPath(file.path)));
    fromArtifacts.push({ ...file, data });
  }
  await applySnapshotToRoot(tmp, after5);
  await applySnapshotToRoot(tmp, fromArtifacts);
  await check("restore from hashed artifacts matches in-memory snapshot", async () => {
    assert.equal(await fs.readFile(path.join(tmp, "a.txt"), "utf8"), "A0\n");
    assert.equal(await exists(tmp, "c.txt"), false);
  });
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

const probeName = `.rewind-probe-${Date.now()}.txt`;
const probePath = path.join(AGENT_ROOT, probeName);
let pkgBefore = "";
try {
  pkgBefore = await fs.readFile(path.join(AGENT_ROOT, "package.json"), "utf8");
  const live = await snap(AGENT_ROOT);
  await fs.writeFile(probePath, "rewind-probe\n");
  assert.equal(await exists(AGENT_ROOT, probeName), true);
  const result = await applySnapshotToRoot(AGENT_ROOT, live);
  await check("live workspace probe file is removed by snapshot restore", async () => {
    assert.equal(await exists(AGENT_ROOT, probeName), false);
    assert.ok(result.deleted >= 1);
  });
  await check("live workspace package.json unchanged after probe restore", async () => {
    const pkgAfter = await fs.readFile(path.join(AGENT_ROOT, "package.json"), "utf8");
    assert.equal(pkgAfter, pkgBefore);
    assert.equal(hashBuffer(Buffer.from(pkgAfter)), hashBuffer(Buffer.from(pkgBefore)));
  });
} catch (error) {
  failed += 1;
  console.error(`FAIL  live workspace probe: ${(error as Error).message}`);
} finally {
  await fs.rm(probePath, { force: true });
}

if (failed) process.exit(1);
console.log("All realistic rewind tests passed.");
