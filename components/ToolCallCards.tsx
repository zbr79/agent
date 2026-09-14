"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Loader2,
} from "lucide-react";
import { activityTrailLabel } from "@/lib/markers";
import { useUiLang } from "@/lib/i18n";
import {
  StatusGlyph,
  formatDuration,
  isEditLike,
  primaryTitle,
  toolIcon,
  toolVerb,
  type ActivityItem,
} from "./ActivityPanel";
import { DiffText } from "./ChangesSummary";

// Keys are matched against transcript "→ label" lines emitted by the agent
// so each text-wave line can be replaced by its rich activity card.
export function stepKeyFromLabel(label: string): string {
  return label
    .replace(/^\s*\u2192\s*/, "")
    .replace(/\s*\(\+\d+\s*-\d+\)\s*$/, "")
    .replace(/\s*[\u2713\u2717]\s*$/, "")
    .trim()
    .toLowerCase();
}

export function activityStepKey(event: ActivityItem): string {
  return stepKeyFromLabel(activityTrailLabel(event) ?? "");
}

export function buildActivityQueues(items: ActivityItem[]): Map<string, ActivityItem[]> {
  const map = new Map<string, ActivityItem[]>();
  for (const item of items) {
    if (item.kind === "text") continue;
    const key = activityStepKey(item);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** Pop the activities matching these transcript trail lines, in order. */
export function takeMatchedActivities(
  queues: Map<string, ActivityItem[]>,
  labels: string[]
): { matched: ActivityItem[]; unmatched: string[] } {
  const matched: ActivityItem[] = [];
  const unmatched: string[] = [];
  for (const label of labels) {
    const queue = queues.get(stepKeyFromLabel(label));
    if (queue && queue.length) matched.push(queue.shift() as ActivityItem);
    else unmatched.push(label);
  }
  return { matched, unmatched };
}

function rowDuration(
  timing: { start: number; end?: number } | undefined,
  status: ActivityItem["status"],
  now: number
): string {
  if (!timing) return "";
  const end = status === "running" ? now : timing.end ?? now;
  return formatDuration(Math.max(0, end - timing.start));
}

const FILE_TOOLS = new Set([
  "read",
  "list",
  "edit",
  "write",
  "apply_patch",
  "patch",
  "grep",
  "glob",
]);

/** File tools show the bare name (folder stays in the tooltip); everything
 *  else (bash commands, web queries) shows its full descriptive target. */
export function fileTarget(item: ActivityItem): string {
  const tool = (item.tool || "").toLowerCase();
  if (item.path && FILE_TOOLS.has(tool)) {
    const index = item.path.lastIndexOf("/");
    return index >= 0 ? item.path.slice(index + 1) : item.path;
  }
  return primaryTitle(item);
}

function ToolCallRow({
  item,
  open,
  onToggle,
  duration,
  retried = false,
}: {
  item: ActivityItem;
  open: boolean;
  onToggle: () => void;
  duration: string;
  retried?: boolean;
}) {
  const lang = useUiLang();
  const Icon = toolIcon(item.tool);
  const verb = toolVerb(item.tool, lang);
  const title = fileTarget(item);
  const expandable =
    Boolean(item.output) || (isEditLike(item) && Boolean(item.path || item.title));
  return (
    <div
      className={`tcc-row status-${item.status === "interrupted" ? "error" : item.status}${
        retried ? " retried" : ""
      }`}
    >
      <button
        type="button"
        className="tcc-head"
        onClick={expandable ? onToggle : undefined}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="tcc-icon" aria-hidden="true">
          <Icon size={13} />
        </span>
        <span className="tcc-verb">{verb}</span>
        <span className="tcc-target" title={item.path || item.title || item.detail || ""}>
          {title}
        </span>
        {item.additions != null && item.additions > 0 ? (
          <span className="tcc-diff add">{`+${item.additions}`}</span>
        ) : null}
        {item.deletions != null && item.deletions > 0 ? (
          <span className="tcc-diff del">{`\u2212${item.deletions}`}</span>
        ) : null}
        <span className="tcc-time">
          {item.status === "running" ? "" : duration}
        </span>
        {expandable ? (
          open ? (
            <ChevronDown size={13} className="tcc-chevron" aria-hidden="true" />
          ) : (
            <ChevronRight size={13} className="tcc-chevron" aria-hidden="true" />
          )
        ) : null}
        <StatusGlyph status={item.status} />
      </button>
      {expandable && open ? (
        <div className="tcc-detail">
          {item.output ? <DiffText text={item.output} /> : null}
          {!item.output && item.path ? (
            <div className="tcc-path">{item.path}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Inline transcript replacement for the raw "→ …" trail lines. Collapses
 *  to a single quiet summary once the run finishes; expands on demand. */
export default function ToolCallGroup({
  items,
  active = false,
}: {
  items: ActivityItem[];
  active?: boolean;
}) {
  const lang = useUiLang();
  const zh = lang === "zh";
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const timingsRef = useRef<Map<string, { start: number; end?: number }>>(new Map());
  const wasActiveRef = useRef(active);

  useEffect(() => {
    const stamp = Date.now();
    for (const item of items) {
      const existing = timingsRef.current.get(item.id);
      if (!existing) {
        timingsRef.current.set(item.id, {
          start: stamp,
          end: item.status === "running" ? undefined : stamp,
        });
      } else if (item.status !== "running" && existing.end == null) {
        existing.end = stamp;
      }
    }
  }, [items]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (wasActiveRef.current && !active) setOpen(false);
    wasActiveRef.current = active;
  }, [active]);

  if (!items.length) return null;

  // An error whose same-target call later succeeded was just a retry blip —
  // show it dimmed, not alarming-red.
  const keys = items.map((item) => activityStepKey(item));
  const laterCompleted = new Set<string>();
  const retriedFlags: boolean[] = new Array(items.length).fill(false);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const key = keys[i];
    if (!key) continue;
    if (items[i].status === "completed") laterCompleted.add(key);
    else if (
      (items[i].status === "error" || items[i].status === "interrupted") &&
      laterCompleted.has(key)
    ) {
      retriedFlags[i] = true;
    }
  }

  const errors = items.filter(
    (item, index) =>
      (item.status === "error" || item.status === "interrupted") &&
      !retriedFlags[index]
  ).length;
  const running = items.filter((item) => item.status === "running").length;
  const single = items.length === 1 ? items[0] : null;
  const first = timingsRef.current.get(items[0].id);
  const last = timingsRef.current.get(items[items.length - 1].id);
  const totalMs =
    first && last && (active ? now : last.end ?? now) >= first.start
      ? Math.max(0, (active ? now : last.end ?? now) - first.start)
      : 0;
  const totalLabel =
    !active && totalMs > 0 ? formatDuration(totalMs) : "";
  const expanded = active || open;
  const expandable = items.length > 1 || Boolean(single?.output);

  const summaryLabel = single
    ? `${toolVerb(single.tool, lang)} ${fileTarget(single) || ""}`.trim()
    : active
      ? zh
        ? `${items.length - running}/${items.length} 步进行中`
        : `${items.length - running}/${items.length} steps`
      : zh
        ? `${items.length} 个步骤`
        : `${items.length} steps`;

  return (
    <div
      className={`tcc${active ? " live" : ""}${expanded ? " open" : ""}${single ? " single" : ""}`}
      aria-label="Tool calls"
    >
      <button
        type="button"
        className="tcc-summary"
        onClick={expandable ? () => setOpen((v) => !v) : undefined}
        disabled={!expandable}
        aria-expanded={expandable ? expanded : undefined}
      >
        {active ? (
          <Loader2 size={13} className="tcc-sum-icon spin" aria-hidden="true" />
        ) : errors ? (
          <CircleAlert size={13} className="tcc-sum-icon err" aria-hidden="true" />
        ) : (
          <Check size={13} className="tcc-sum-icon ok" aria-hidden="true" />
        )}
        <span className="tcc-sum-label">{summaryLabel}</span>
        {errors > 1 ? (
          <span className="tcc-sum-err">{zh ? `${errors} 次失败` : `${errors} failed`}</span>
        ) : null}
        <span className="tcc-sum-time">{totalLabel}</span>
        {expandable ? (
          expanded ? (
            <ChevronDown size={13} className="tcc-chevron" aria-hidden="true" />
          ) : (
            <ChevronRight size={13} className="tcc-chevron" aria-hidden="true" />
          )
        ) : null}
      </button>
      {expanded ? (
        <div className="tcc-rows">
          {items.map((item, index) => (
            <ToolCallRow
              key={item.id}
              item={item}
              retried={retriedFlags[index]}
              open={Boolean(openIds[item.id])}
              onToggle={() =>
                setOpenIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
              }
              duration={rowDuration(timingsRef.current.get(item.id), item.status, now)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
