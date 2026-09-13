import { spawn } from "node:child_process";
import { AGENT_ROOT, assertAllowedAgentFile } from "./pathJail";

const GIT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1_500_000;

export interface GitFile {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  safe: boolean;
}

export interface GitStatus {
  branch: string;
  upstream: string | null;
  files: GitFile[];
  clean: boolean;
  skipped: string[];
}

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runGit(args: string[], input?: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: AGENT_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`git ${args[0] ?? "command"} timed out.`));
    }, GIT_TIMEOUT_MS);

    const finish = (error?: Error, result?: GitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result as GitResult);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        finish(new Error("git output was too large."));
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        finish(new Error("git error output was too large."));
      }
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(undefined, { stdout, stderr, code: code ?? 1 }));
    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

function gitError(result: GitResult, fallback: string): Error {
  const detail = (result.stderr || result.stdout).trim();
  return new Error(detail || fallback);
}

function safeRelativePath(raw: string): boolean {
  try {
    assertAllowedAgentFile(raw);
    return true;
  } catch {
    return false;
  }
}

function parseStatus(output: string): GitFile[] {
  const files: GitFile[] = [];
  for (const entry of output.split("\0")) {
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (status.length !== 2 || !filePath) continue;
    const untracked = status === "??";
    files.push({
      path: filePath,
      status,
      staged: !untracked && status[0] !== " ",
      unstaged: !untracked && status[1] !== " ",
      untracked,
      safe: safeRelativePath(filePath),
    });
  }
  return files;
}

async function gitValue(args: string[], fallback = ""): Promise<string> {
  const result = await runGit(args);
  if (result.code !== 0) throw gitError(result, fallback);
  return result.stdout.trim();
}

export async function getGitStatus(): Promise<GitStatus> {
  const [branch, statusOutput] = await Promise.all([
    gitValue(["rev-parse", "--abbrev-ref", "HEAD"], "Could not determine the current branch."),
    gitValue(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      "Could not read git status."
    ),
  ]);
  let upstream: string | null = null;
  try {
    upstream = await gitValue(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  } catch {
    upstream = null;
  }
  const files = parseStatus(statusOutput);
  return {
    branch,
    upstream,
    files,
    clean: files.length === 0,
    skipped: files.filter((file) => !file.safe).map((file) => file.path),
  };
}

async function safeFiles(): Promise<{ files: GitFile[]; skipped: string[] }> {
  const status = await getGitStatus();
  const files = status.files.filter((file) => file.safe);
  return { files, skipped: status.skipped };
}

async function diffForPath(filePath: string): Promise<string> {
  const result = await runGit(["diff", "--no-index", "--", "/dev/null", filePath]);
  if (result.code !== 0 && result.code !== 1) {
    throw gitError(result, `Could not read the diff for ${filePath}.`);
  }
  return result.stdout;
}

export async function getGitContext(): Promise<{
  status: GitStatus;
  diff: string;
  log: string;
}> {
  const status = await getGitStatus();
  const safe = status.files.filter((file) => file.safe);
  const trackedDiff =
    safe.length > 0
      ? await runGit([
          "diff",
          "--no-ext-diff",
          "--binary",
          "HEAD",
          "--",
          ...safe.filter((file) => !file.untracked).map((file) => file.path),
        ])
      : { stdout: "", stderr: "", code: 0 };
  if (trackedDiff.code !== 0) {
    throw gitError(trackedDiff, "Could not read the git diff.");
  }
  const untrackedDiffs: string[] = [];
  for (const file of safe.filter((item) => item.untracked)) {
    untrackedDiffs.push(await diffForPath(file.path));
  }
  let log = "";
  try {
    log = await gitValue(["log", "-8", "--oneline"]);
  } catch {
    log = "";
  }
  return {
    status,
    diff: `${trackedDiff.stdout}\n${untrackedDiffs.join("\n")}`.slice(0, MAX_OUTPUT_BYTES),
    log,
  };
}

function validateCommitMessage(message: unknown): string {
  if (typeof message !== "string") throw new Error("Commit message must be text.");
  const clean = message.trim();
  if (!clean) throw new Error("Commit message cannot be empty.");
  if (clean.length > 500) throw new Error("Commit message is too long.");
  if (clean.includes("\0")) throw new Error("Commit message contains an invalid character.");
  return clean;
}

/** Where a push should land: the remote's own default branch (origin/main
 *  here), never a same-named copy of the local branch. This workspace runs
 *  on a long-lived feature branch, and `push -u origin HEAD` used to spray
 *  stray origin/cursor/… branches while the deployed origin/main stayed stale. */
async function pushTargetBranch(): Promise<string> {
  try {
    const ref = await gitValue(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    const name = ref.replace(/^origin\//, "").trim();
    if (name) return name;
  } catch {
    /* older clones without origin/HEAD */
  }
  try {
    await gitValue(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]);
    return "main";
  } catch {
    return await gitValue(["rev-parse", "--abbrev-ref", "HEAD"], "Could not read the branch.");
  }
}

export async function commitAndMaybePush(
  message: unknown,
  push: boolean
): Promise<{ sha: string; branch: string; pushed: boolean; remote: string | null; skipped: string[] }> {
  const cleanMessage = validateCommitMessage(message);
  const { files, skipped } = await safeFiles();
  const stagedDenylisted = (await getGitStatus()).files.filter(
    (file) => !file.safe && file.staged
  );
  if (stagedDenylisted.length > 0) {
    throw new Error(
      `Denylisted files are already staged; unstage them before committing: ${stagedDenylisted
        .map((file) => file.path)
        .join(", ")}`
    );
  }
  if (files.length === 0) {
    throw new Error(
      skipped.length > 0
        ? "Only denylisted files changed; nothing safe to commit."
        : "There are no changes to commit."
    );
  }
  for (const file of files) {
    const result = await runGit(["add", "--", file.path]);
    if (result.code !== 0) throw gitError(result, `Could not stage ${file.path}.`);
  }
  const commit = await runGit(["commit", "-F", "-"], cleanMessage + "\n");
  if (commit.code !== 0) throw gitError(commit, "Could not create the commit.");
  const sha = await gitValue(["rev-parse", "--short", "HEAD"], "Could not read the commit id.");
  const branch = await gitValue(["rev-parse", "--abbrev-ref", "HEAD"], "Could not read the branch.");
  let remote: string | null = null;
  let pushed = false;
  if (push) {
    const target = await pushTargetBranch();
    const pushResult = await runGit(["push", "origin", `HEAD:${target}`]);
    if (pushResult.code !== 0) {
      const detail = (pushResult.stderr || pushResult.stdout).trim();
      throw new Error(
        detail.includes("rejected") || detail.includes("non-fast-forward")
          ? `Commit succeeded, but push was rejected: origin/${target} has commits this branch does not. Pull or rebase first.`
          : `Commit succeeded, but push failed: ${detail.slice(0, 300) || "unknown git error."}`
      );
    }
    pushed = true;
    remote = `origin/${target}`;
  }
  return { sha, branch, pushed, remote, skipped };
}

export { validateCommitMessage };
