"use client";

import { ChevronDown, ChevronRight, FilePenLine } from "lucide-react";
import { useUiLang } from "@/lib/i18n";
import { useChangesOpen } from "@/lib/prefs";
import { toWorkspaceRelative } from "@/lib/workspacePath";
import { isEditLike, type ActivityItem } from "./ActivityPanel";

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  output?: string;
  failed?: boolean;
}

export function looksLikeDiff(text: string): boolean {
  let hits = 0;
  for (const line of text.split("\n")) {
    if (
      line.startsWith("@@") ||
      (line.startsWith("+") && !line.startsWith("+++")) ||
      (line.startsWith("-") && !line.startsWith("---") && line !== "--")
    ) {
      hits += 1;
      if (hits >= 2) return true;
    }
  }
  return false;
}

function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "file";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

export function DiffText({ text }: { text: string }) {
  if (!looksLikeDiff(text)) {
    return <pre className="tcc-output">{text}</pre>;
  }
  return (
    <div className="diff-pre" role="log">
      {text.split("\n").map((line, index) => (
        <span key={index} className={`diff-line ${diffLineClass(line)}`}>
          {line || " "}
        </span>
      ))}
    </div>
  );
}

function displayName(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

/** Aggregate edit/write/patch activities into a per-file changes list:
 *  file name + lines added/removed (+10 green / −5 red). Static — the
 *  diffs themselves stay inspectable through the tool cards above. */
export default function ChangesSummary({ items }: { items: ActivityItem[] }) {
  const lang = useUiLang();
  const zh = lang === "zh";

  const byPath = new Map<string, FileChange>();
  const touch = (path: string): FileChange | null => {
    const clean = toWorkspaceRelative(path)
      .trim()
      .replace(/^\.\/*/, "")
      .replace(/\/{2,}/g, "/");
    if (!clean || clean === "." || clean === "patch" || clean === "files") return null;
    let entry = byPath.get(clean);
    if (!entry) {
      entry = { path: clean, additions: 0, deletions: 0 };
      byPath.set(clean, entry);
    }
    return entry;
  };

  // Pass 1: real edit/write tool events — the authoritative file set.
  const patchListings: string[][] = [];
  for (const item of items) {
    if (item.status === "running") continue;
    if (item.kind === "patch" && !item.additions && !item.deletions) {
      const listing = (item.output || item.detail || "")
        .split(/[\n,]/)
        .map((raw) => raw.replace(/^[•\s-]+/, "").trim())
        .filter(Boolean);
      patchListings.push(listing.length ? listing : [item.path || item.title || ""]);
      continue;
    }
    if (!isEditLike(item)) continue;
    const entry = touch(item.path || item.title || "");
    if (!entry) continue;
    entry.additions += item.additions ?? 0;
    entry.deletions += item.deletions ?? 0;
    if (item.output) entry.output = item.output;
    // Status follows the LAST attempt at this file: a failed edit that was
    // immediately retried and succeeded must not leave the row red.
    entry.failed = item.status === "error" || item.status === "interrupted";
  }
  // Pass 2: patch-part listings only contribute files no edit event covered
  // (they can span the whole session — counting them blindly double-counts).
  for (const listing of patchListings) {
    for (const raw of listing) touch(raw);
  }

  const files = Array.from(byPath.values());
  if (!files.length) return null;
  // Bare file names; when two changed files share one, extend only the
  // colliding rows to the shortest unique suffix ("chat/route.ts").
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const base = displayName(file.path);
    const group = groups.get(base);
    if (group) group.push(file.path);
    else groups.set(base, [file.path]);
  }
  const labels = new Map<string, string>();
  for (const [base, group] of groups) {
    if (group.length === 1) {
      labels.set(group[0] as string, base);
      continue;
    }
    const segs = group.map((path) => path.split("/"));
    const maxLen = Math.max(...segs.map((parts) => parts.length));
    let chosen = segs.map((parts) => parts[parts.length - 1] ?? base);
    for (let depth = 2; depth <= maxLen; depth += 1) {
      chosen = segs.map((parts) => parts.slice(-depth).join("/"));
      if (new Set(chosen).size === chosen.length) break;
    }
    group.forEach((path, index) => labels.set(path, chosen[index] ?? base));
  }
  const rowLabel = (path: string) => labels.get(path) ?? displayName(path);
  const label =
    files.length === 1
      ? zh
        ? "1 个文件已修改"
        : "1 file changed"
      : zh
        ? `${files.length} 个文件已修改`
        : `${files.length} files changed`;

  const [open, setOpen] = useChangesOpen();

  return (
    <div className="changes-card">
      <button
        type="button"
        className="changes-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={open ? (zh ? "收起" : "Collapse") : zh ? "展开" : "Expand"}
      >
        <FilePenLine size={13} className="changes-head-icon" aria-hidden="true" />
        <span className="changes-label">{label}</span>
        <span className="changes-spacer" />
        {open ? (
          <ChevronDown size={13} className="changes-chevron" aria-hidden="true" />
        ) : (
          <ChevronRight size={13} className="changes-chevron" aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div className="changes-files">
          {files.map((file) => (
            <div key={file.path} className={`changes-file${file.failed ? " failed" : ""}`}>
              <div className="changes-file-row" title={file.path}>
                <span className="changes-file-path">
                  <span className="changes-file-name">{rowLabel(file.path)}</span>
                </span>
                <span className="changes-stats">
                  {file.additions > 0 ? <span className="add">+{file.additions}</span> : null}
                  {file.deletions > 0 ? <span className="del">−{file.deletions}</span> : null}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
