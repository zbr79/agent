import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AGENT_ROOT, assertAllowedAgentFile } from "./pathJail";
import type { WorkspaceChanges } from "./types";

const execFileAsync = promisify(execFile);

function countTextLines(filePath: string): number {
  let buffer: Buffer;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return 0;
    buffer = fs.readFileSync(filePath);
  } catch {
    return 0;
  }
  if (buffer.includes(0)) return 0;
  if (buffer.length === 0) return 0;
  const text = buffer.toString("utf8");
  return text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
}

export async function getWorkspaceChanges(workspaceRoot = AGENT_ROOT): Promise<WorkspaceChanges> {
  const { stdout: diff } = await execFileAsync(
    "git",
    ["diff", "--numstat", "HEAD", "--"],
    { cwd: workspaceRoot, maxBuffer: 2 * 1024 * 1024 }
  );
  const result: WorkspaceChanges = { additions: 0, deletions: 0, files: 0 };

  for (const line of diff.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [rawAdditions, rawDeletions] = line.split("\t");
    result.additions += Number.isFinite(Number(rawAdditions)) ? Number(rawAdditions) : 0;
    result.deletions += Number.isFinite(Number(rawDeletions)) ? Number(rawDeletions) : 0;
    result.files += 1;
  }

  const { stdout: untracked } = await execFileAsync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: workspaceRoot, maxBuffer: 2 * 1024 * 1024 }
  );
  for (const relativePath of untracked.split("\0")) {
    if (!relativePath) continue;
    let filePath: string;
    try {
      filePath = assertAllowedAgentFile(path.resolve(workspaceRoot, relativePath), workspaceRoot);
    } catch {
      continue;
    }
    result.additions += countTextLines(filePath);
    result.files += 1;
  }

  return result;
}
