#!/usr/bin/env node
/**
 * Snapshot restore tests for lib/checkpointSnapshot.ts.
 * Run: npx tsx scripts/test-checkpoints.mts
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  applySnapshotToRoot,
  captureSnapshot,
  type SnapshotFile,
} from "../lib/checkpointSnapshot.ts";
import { PathJailError } from "../lib/pathJail.ts";

const exec = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-checkpoint-"));

async function git(...args: string[]) {
  return exec("git", args, { cwd: root, encoding: "utf8" });
}

async function writeTracked(relative: string, contents: string) {
  const absolute = path.join(root, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents);
}

async function snap(): Promise<SnapshotFile[]> {
  return (await captureSnapshot(root, true)) as SnapshotFile[];
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

try {
  await git("init", "-b", "main");
  await git("config", "user.name", "Checkpoint test");
  await git("config", "user.email", "checkpoint-test@example.invalid");
  await writeTracked("a.txt", "A1\n");
  await git("add", "a.txt");
  await git("commit", "-m", "start");

  const snap1 = await snap();
  await check("snapshot 1 captures A1", () => {
    const file = snap1.find((item) => item.path === "a.txt");
    assert.ok(file);
    assert.equal(file.data.toString(), "A1\n");
  });

  await writeTracked("a.txt", "A2\n");
  await writeTracked("b.txt", "B\n");
  const snap2 = await snap();

  await writeTracked("a.txt", "A3\n");
  await writeTracked("c.txt", "C\n");

  const deep = await applySnapshotToRoot(root, snap1);
  await check("restore snapshot 1 undoes later files", async () => {
    assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "A1\n");
    await assert.rejects(fs.access(path.join(root, "b.txt")));
    await assert.rejects(fs.access(path.join(root, "c.txt")));
    assert.ok(deep.written >= 1);
    assert.ok(deep.deleted >= 1);
  });

  await writeTracked("a.txt", "A3\n");
  await writeTracked("b.txt", "B\n");
  await writeTracked("c.txt", "C\n");
  const snap3 = await snap();
  const last = await applySnapshotToRoot(root, snap3);
  await check("restore latest snapshot is a no-op when hashes match", async () => {
    assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "A3\n");
    assert.equal(await fs.readFile(path.join(root, "b.txt"), "utf8"), "B\n");
    assert.equal(last.written, 0);
    assert.equal(last.deleted, 0);
  });

  await applySnapshotToRoot(root, snap2);
  await check("restore snapshot 2 keeps B and drops C", async () => {
    assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "A2\n");
    assert.equal(await fs.readFile(path.join(root, "b.txt"), "utf8"), "B\n");
    await assert.rejects(fs.access(path.join(root, "c.txt")));
  });

  await check("path jail blocks snapshot writes outside the root", async () => {
    await assert.rejects(
      () =>
        applySnapshotToRoot(root, [
          {
            path: "../escape.txt",
            hash: "x",
            size: 1,
            mode: 0o644,
            data: Buffer.from("nope"),
          },
        ]),
      (error: unknown) => error instanceof PathJailError
    );
  });
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log("All checkpoint snapshot tests passed.");
