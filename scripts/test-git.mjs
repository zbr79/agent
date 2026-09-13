#!/usr/bin/env node
/**
 * Contract tests for the safe git workflow used by lib/git.ts.
 * Run: node scripts/test-git.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-git-"));

async function git(...args) {
  return exec("git", args, { cwd: root, encoding: "utf8" });
}

function gitWithInput(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `git exited with ${code}`));
    });
    child.stdin.end(input);
  });
}

function isDenylisted(filePath) {
  const base = path.basename(filePath);
  return (
    base === ".server-env" ||
    base.startsWith(".env") ||
    ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"].includes(base) ||
    base.endsWith("_rsa") ||
    base.endsWith("_ed25519") ||
    /\.(pem|ppk|key)$/i.test(base)
  );
}

let failed = 0;
function check(name, callback) {
  try {
    callback();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}

try {
  await git("init", "-b", "main");
  await git("config", "user.name", "Git workflow test");
  await git("config", "user.email", "git-workflow-test@example.invalid");
  await fs.writeFile(path.join(root, "safe.txt"), "safe\n");
  await fs.writeFile(path.join(root, ".env"), "SECRET=must-not-stage\n");
  await fs.writeFile(path.join(root, "private.pem"), "PRIVATE KEY\n");

  const status = await git("status", "--porcelain=v1", "-z", "--untracked-files=all");
  const paths = status.stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3));
  check("status discovers safe and secret files", () =>
    assert.deepEqual(new Set(paths), new Set(["safe.txt", ".env", "private.pem"]))
  );
  check("denylist excludes environment and key material", () => {
    assert.equal(isDenylisted(".env"), true);
    assert.equal(isDenylisted("private.pem"), true);
    assert.equal(isDenylisted("safe.txt"), false);
  });

  await git("add", "--", "safe.txt");
  await gitWithInput(["commit", "-F", "-"], "Add safe test fixture\n");
  const log = await git("log", "-1", "--pretty=%s");
  check("commit message is read from stdin", () => assert.equal(log.stdout.trim(), "Add safe test fixture"));
  const after = await git("status", "--porcelain=v1");
  check("denylisted files remain unstaged", () =>
    assert.match(after.stdout, /\?\? \.env/) && assert.match(after.stdout, /\?\? private\.pem/)
  );
  check("push contract contains no force flags", () => {
    const pushArgs = ["push", "-u", "origin", "HEAD"];
    assert.equal(pushArgs.some((arg) => arg === "-f" || arg.startsWith("--force")), false);
  });
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

if (failed > 0) process.exit(1);
console.log("\nAll git workflow tests passed.");
