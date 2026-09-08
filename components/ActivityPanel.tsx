"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  FilePenLine,
  FileSearch,
  FileText,
  FolderSearch,
  Loader2,
  Search,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { ActivityEvent } from "@/lib/markers";
import { STR, useUiLang, type UiLang } from "@/lib/i18n";

export type ActivityItem = ActivityEvent;

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_closed"
  | "failed"
  | "interrupted";

function toolIcon(tool?: string) {
  const key = (tool || "").toLowerCase();
  if (key === "read" || key === "list") return FileText;
  if (key === "grep") return Search;
  if (key === "glob") return FolderSearch;
  if (key === "edit" || key === "write" || key === "apply_patch" || key === "patch") {
    return FilePenLine;
  }
  if (key === "bash" || key === "shell") return SquareTerminal;
  if (key === "webfetch" || key === "fetch") return FileSearch;
  return Wrench;
}

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function toolVerb(tool: string | undefined, lang: UiLang): string {
  const key = (tool || "").toLowerCase();
  const verbMap: Record<string, { en: string; zh: string }> = {
    read: { en: "Read", zh: "读取" },
    write: { en: "Write", zh: "写入" },
    edit: { en: "Edit", zh: "编辑" },
    bash: { en: "Bash", zh: "终端" },
    shell: { en: "Shell", zh: "终端" },
    grep: { en: "Grep", zh: "搜索" },
    glob: { en: "Glob", zh: "匹配" },
    list: { en: "List", zh: "列出" },
    webfetch: { en: "Fetch", zh: "获取" },
    fetch: { en: "Fetch", zh: "获取" },
    task: { en: "Task", zh: "任务" },
    apply_patch: { en: "Patch", zh: "补丁" },
    patch: { en: "Patch", zh: "补丁" },
  };
  const verb = verbMap[key];
  if (verb) return lang === "zh" ? verb.zh : verb.en;
  return capitalize(tool || (lang === "zh" ? "步骤" : "Step"));
}

function primaryTitle(item: ActivityItem): string {
  const path = (item.path || "").trim();
  const detail = (item.detail || "").trim();
  const title = (item.title || "").trim();
  const raw = path || detail || title;
  if (!raw) return "";
  return raw.length > 96 ? `${raw.slice(0, 96)}…` : raw;
}

function isEditLike(item: ActivityItem): boolean {
  const key = (item.tool || "").toLowerCase();
  return (
    item.kind === "patch" ||
    key === "edit" ||
    key === "write" ||
    key === "apply_patch" ||
    key === "patch"
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.max(1, Math.round(ms / 100) * 100)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${mins}m ${rem}s`;
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const rem = (seconds % 60).toFixed(1);
  return `${mins}m ${rem}s`;
}

export function deriveRunStatus(
  items: ActivityItem[],
  active: boolean,
  endHint?: "completed" | "completed_closed" | "failed" | "interrupted" | null
): RunStatus {
  if (active) {
    if (!items.length) return "queued";
    return "running";
  }
  if (endHint === "failed") return "failed";
  if (endHint === "interrupted") return "interrupted";
  if (endHint === "completed_closed") return "completed_closed";
  if (endHint === "completed") return "completed";
  if (items.some((item) => item.status === "error")) return "failed";
  if (items.some((item) => item.status === "interrupted")) return "interrupted";
  if (items.some((item) => item.status === "running")) return "interrupted";
  return "completed";
}

/** True when the activity trail shows useful finished work (not just errors). */
export function hasSuccessfulProgress(items: ActivityItem[]): boolean {
  return items.some((item) => {
    if (item.status === "completed") return true;
    if (item.kind === "patch" && item.status !== "error") return true;
    // Edit/write/bash that finished without error counts even if status glitched.
    const tool = (item.tool || "").toLowerCase();
    if (
      item.status !== "error" &&
      item.status !== "interrupted" &&
      (tool === "edit" ||
        tool === "write" ||
        tool === "bash" ||
        tool === "shell" ||
        tool === "apply_patch" ||
        tool === "patch") &&
      (item.path || item.output || item.additions != null)
    ) {
      return true;
    }
    return false;
  });
}

/** True when any tool hard-errored (ignore deferred-restart bash noise). */
export function hasToolErrors(items: ActivityItem[]): boolean {
  return items.some((item) => {
    if (item.status !== "error") return false;
    const blob = `${item.detail || ""} ${item.title || ""} ${item.output || ""} ${item.path || ""}`.toLowerCase();
    if (blob.includes("restart-agent-deferred")) return false;
    return true;
  });
}

function StatusGlyph({ status }: { status: ActivityItem["status"] }) {
  if (status === "completed") {
    return <Check size={14} className="activity-status ok" aria-hidden="true" />;
  }
  if (status === "error" || status === "interrupted") {
    return <CircleAlert size={14} className="activity-status err" aria-hidden="true" />;
  }
  return <Loader2 size={14} className="activity-status spin" aria-hidden="true" />;
}

function RunStatusIcon({ status }: { status: RunStatus }) {
  if (status === "queued") {
    return <CircleDashed size={14} className="activity-run-icon queued" aria-hidden="true" />;
  }
  if (status === "running") {
    return <Loader2 size={14} className="activity-run-icon spin" aria-hidden="true" />;
  }
  if (status === "completed" || status === "completed_closed") {
    return <Check size={14} className="activity-run-icon ok" aria-hidden="true" />;
  }
  return <CircleAlert size={14} className="activity-run-icon err" aria-hidden="true" />;
}

function collectChangedFiles(items: ActivityItem[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const item of items) {
    if (item.status !== "completed" && item.status !== "error") continue;
    if (!isEditLike(item)) continue;
    const candidates = [
      item.path,
      item.title,
      ...(item.detail ? item.detail.split(",").map((s) => s.trim()) : []),
    ].filter(Boolean) as string[];
    for (const candidate of candidates) {
      if (!candidate || candidate.includes(" ") && !candidate.includes("/") && !candidate.includes("\\")) {
        // skip vague titles like "3 files" unless path-like
        if (!candidate.includes("/") && !candidate.includes("\\") && !candidate.includes(".")) continue;
      }
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      files.push(candidate);
    }
  }
  return files;
}

const COLLAPSE_THRESHOLD = 5;

export default function ActivityPanel({
  items,
  active = false,
  endHint = null,
}: {
  items: ActivityItem[];
  active?: boolean;
  endHint?: "completed" | "completed_closed" | "failed" | "interrupted" | null;
}) {
  const lang = useUiLang();
  const t = STR[lang];
  const runStatus = deriveRunStatus(items, active, endHint);
  const [now, setNow] = useState(() => Date.now());
  const [expandedCompleted, setExpandedCompleted] = useState(false);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const runStartedAtRef = useRef<number | null>(null);
  const runEndedAtRef = useRef<number | null>(null);
  const stepTimingRef = useRef<Map<string, { start: number; end?: number }>>(new Map());
  const prevIdsRef = useRef<string>("");

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);

  // Reset per-run timers when the activity list is cleared for a new turn.
  useEffect(() => {
    const ids = items.map((item) => item.id).join("|");
    if (!items.length) {
      stepTimingRef.current = new Map();
      prevIdsRef.current = "";
      if (!active) {
        runStartedAtRef.current = null;
        runEndedAtRef.current = null;
      }
      return;
    }
    if (prevIdsRef.current && ids && !prevIdsRef.current.split("|").some((id) => ids.includes(id))) {
      stepTimingRef.current = new Map();
    }
    prevIdsRef.current = ids;
  }, [items, active]);

  useEffect(() => {
    if (active) {
      if (runStartedAtRef.current == null) runStartedAtRef.current = Date.now();
      runEndedAtRef.current = null;
      return;
    }
    if (runStartedAtRef.current != null && runEndedAtRef.current == null) {
      runEndedAtRef.current = Date.now();
      setNow(runEndedAtRef.current);
    }
    return;
  }, [active]);

  useEffect(() => {
    const stamp = Date.now();
    for (const item of items) {
      const existing = stepTimingRef.current.get(item.id);
      if (!existing) {
        stepTimingRef.current.set(item.id, {
          start: stamp,
          end: item.status === "running" ? undefined : stamp,
        });
      } else if (item.status !== "running" && existing.end == null) {
        existing.end = stamp;
      }
    }
  }, [items]);

  const elapsedMs = useMemo(() => {
    const start = runStartedAtRef.current;
    if (start == null) return 0;
    const end = active ? now : runEndedAtRef.current ?? now;
    return Math.max(0, end - start);
  }, [active, now, items.length]);

  const changedFiles = useMemo(() => collectChangedFiles(items), [items]);

  const statusLabel = useMemo(() => {
    const key =
      runStatus === "queued"
        ? "activity.queued"
        : runStatus === "running"
          ? "activity.running"
          : runStatus === "completed"
            ? "activity.completed"
            : runStatus === "completed_closed"
              ? "activity.completedClosed"
              : runStatus === "failed"
                ? "activity.failed"
                : "activity.interrupted";
    return t[key] || runStatus;
  }, [runStatus, t]);

  if (!items.length && !active) return null;

  const completed = items.filter((item) => item.status !== "running");
  const running = items.filter((item) => item.status === "running");
  const shouldCollapse =
    completed.length >= COLLAPSE_THRESHOLD && (active || items.length > COLLAPSE_THRESHOLD + 1);
  const hiddenCompleted =
    shouldCollapse && !expandedCompleted
      ? completed.slice(0, Math.max(0, completed.length - 2))
      : [];
  const visibleCompleted =
    shouldCollapse && !expandedCompleted
      ? completed.slice(Math.max(0, completed.length - 2))
      : completed;
  const visibleItems = [...visibleCompleted, ...running];

  const toggleOpen = (id: string) => {
    setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderRow = (item: ActivityItem) => {
    const Icon = toolIcon(item.tool);
    const primary = primaryTitle(item);
    const secondary = toolVerb(item.tool, lang);
    const timing = stepTimingRef.current.get(item.id);
    let durationLabel = "";
    if (item.status !== "running" && timing?.end != null) {
      durationLabel = formatDuration(timing.end - timing.start);
    }
    const expandable =
      Boolean(item.output) ||
      (isEditLike(item) && (item.additions != null || item.deletions != null || item.path));
    const open = Boolean(openIds[item.id]);
    const diffMeta =
      item.additions != null || item.deletions != null
        ? `+${item.additions ?? 0} / -${item.deletions ?? 0}`
        : "";

    return (
      <li
        key={item.id}
        className={`activity-row status-${item.status === "interrupted" ? "error" : item.status}${
          expandable ? " expandable" : ""
        }${open ? " open" : ""}`}
      >
        <button
          type="button"
          className="activity-row-main"
          onClick={expandable ? () => toggleOpen(item.id) : undefined}
          disabled={!expandable}
          aria-expanded={expandable ? open : undefined}
        >
          <span className="activity-icon" aria-hidden="true">
            <Icon size={14} />
          </span>
          <span className="activity-main">
            <span className="activity-primary">
              {primary || secondary || (lang === "zh" ? "处理中" : "Working")}
            </span>
            <span className="activity-secondary">
              {primary ? secondary : null}
              {diffMeta ? (
                <span className="activity-diff-meta">{diffMeta}</span>
              ) : null}
            </span>
          </span>
          {durationLabel ? (
            <span className="activity-duration" title={durationLabel}>
              {durationLabel}
            </span>
          ) : (
            <span className="activity-duration" />
          )}
          {expandable ? (
            open ? (
              <ChevronDown size={14} className="activity-chevron" aria-hidden="true" />
            ) : (
              <ChevronRight size={14} className="activity-chevron" aria-hidden="true" />
            )
          ) : (
            <span className="activity-chevron-spacer" />
          )}
          <StatusGlyph status={item.status} />
        </button>
        {expandable && open && (
          <div className="activity-detail">
            {item.path || item.title ? (
              <div className="activity-detail-path">
                {item.path || item.title}
                {!item.output && isEditLike(item)
                  ? lang === "zh"
                    ? " — 已编辑"
                    : " — edited"
                  : null}
              </div>
            ) : null}
            {item.output ? (
              <pre className="activity-diff">{item.output}</pre>
            ) : null}
          </div>
        )}
      </li>
    );
  };

  const panelStatusClass =
    runStatus === "completed_closed" ? "completed_closed" : runStatus;

  return (
    <section
      className={`activity-panel status-${panelStatusClass}${active ? " live" : " done"}`}
      aria-label={t["activity.title"] || "Activity"}
      aria-live="polite"
    >
      <header className="activity-header">
        <div className="activity-run">
          <RunStatusIcon status={runStatus} />
          <span className="activity-run-label">{statusLabel}</span>
          {!active && elapsedMs > 0 && (
            <span className="activity-elapsed" aria-label="elapsed">
              {formatElapsed(elapsedMs)}
            </span>
          )}
        </div>
        <span className="activity-title">{t["activity.title"] || "Work log"}</span>
      </header>

      {changedFiles.length > 0 && (
        <div className="activity-files">
          <div className="activity-files-label">
            {t["activity.filesChanged"] || (lang === "zh" ? "已改文件" : "Files changed")}
          </div>
          <ul className="activity-files-list">
            {changedFiles.map((file) => (
              <li key={file} title={file}>
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hiddenCompleted.length > 0 && (
        <button
          type="button"
          className="activity-collapse"
          onClick={() => setExpandedCompleted(true)}
        >
          <ChevronRight size={14} aria-hidden="true" />
          <span>
            {(t["activity.stepsCompleted"] || "{n} completed").replace(
              "{n}",
              String(hiddenCompleted.length)
            )}
          </span>
        </button>
      )}

      {shouldCollapse && expandedCompleted && completed.length >= COLLAPSE_THRESHOLD && (
        <button
          type="button"
          className="activity-collapse"
          onClick={() => setExpandedCompleted(false)}
        >
          <ChevronDown size={14} aria-hidden="true" />
          <span>
            {t["activity.hideCompleted"] ||
              (lang === "zh" ? "收起已完成" : "Hide completed")}
          </span>
        </button>
      )}

      {visibleItems.length > 0 && (
        <ol className="activity-list">{visibleItems.map(renderRow)}</ol>
      )}

      {!items.length && active && (
        <p className="activity-empty">
          {t["activity.waiting"] ||
            (lang === "zh" ? "等待工具调用…" : "Waiting for tools…")}
        </p>
      )}
    </section>
  );
}

/** Merge streamed ACTIVITY events into a stable ordered list (update-in-place by id). */
export function upsertActivity(
  prev: ActivityItem[],
  incoming: ActivityItem[]
): ActivityItem[] {
  if (!incoming.length) return prev;
  const next = [...prev];
  const indexById = new Map(next.map((item, index) => [item.id, index]));
  for (const event of incoming) {
    const existing = indexById.get(event.id);
    if (existing === undefined) {
      indexById.set(event.id, next.length);
      next.push(event);
    } else {
      next[existing] = { ...next[existing], ...event };
    }
  }
  return next;
}

/** Mark every still-running activity as error/interrupted/completed so the spinner does not stick. */
export function finalizeRunningActivities(
  prev: ActivityItem[],
  status: "error" | "interrupted" | "completed" = "interrupted"
): ActivityItem[] {
  if (!prev.length) return prev;
  let changed = false;
  const next = prev.map((item) => {
    if (item.status !== "running") return item;
    changed = true;
    return { ...item, status };
  });
  return changed ? next : prev;
}
