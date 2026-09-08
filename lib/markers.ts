// Sentinel markers embedded in the plain-text chat stream so the client
// can show which model is answering / live activity. They use U+2400
// (SYMBOL FOR NULL) as a delimiter because real assistant text never
// contains it.
const MARK = "\u2400";
const MODEL_PREFIX = `${MARK}MODEL:`;
const TRYING_PREFIX = `${MARK}TRYING:`;
const LIMIT_PREFIX = `${MARK}LIMIT:`;
const FREE_PREFIX = `${MARK}FREE:`;
const ACTIVITY_PREFIX = `${MARK}ACTIVITY:`;

export type ActivityStatus = "running" | "completed" | "error" | "interrupted";
export type ActivityKind = "tool" | "text" | "step" | "patch";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  tool?: string;
  title?: string;
  status: ActivityStatus;
  detail?: string;
  /** Truncated tool output / diff snippet for expandable Activity rows. */
  output?: string;
  path?: string;
  additions?: number;
  deletions?: number;
}

export function encodeModelMarker(model: string): string {
  return `${MODEL_PREFIX}${model}${MARK}`;
}

export function encodeTryingMarker(model: string): string {
  return `${TRYING_PREFIX}${model}${MARK}`;
}

export function encodeLimitMarker(resetAt: string): string {
  return `${LIMIT_PREFIX}${resetAt}${MARK}`;
}

// Emitted when a free model answered because the paid Go models failed
// (quota/balance exhausted) in the same request.
export function encodeFreeMarker(): string {
  return `${FREE_PREFIX}${MARK}`;
}

export function encodeActivityMarker(event: ActivityEvent): string {
  return `${ACTIVITY_PREFIX}${JSON.stringify(event)}${MARK}`;
}

/** Transcript trail label (no leading arrow) matching Ran/Read/Edited lines. */
export function activityTrailLabel(event: ActivityEvent): string | null {
  const tool = (event.tool || event.kind || "step").toLowerCase();
  const raw =
    (event.path || "").trim() ||
    (event.title || "").trim() ||
    (event.detail || "").trim() ||
    (event.tool || "").trim();
  if (!raw) return null;
  const target = raw.length > 72 ? `${raw.slice(0, 72)}...` : raw;
  let line: string;
  if (tool === "bash" || tool === "shell") line = `Ran: ${target}`;
  else if (
    tool === "edit" ||
    tool === "write" ||
    tool === "apply_patch" ||
    tool === "patch"
  ) {
    line = `Edited ${target}`;
  } else if (tool === "read" || tool === "list") line = `Read ${target}`;
  else if (tool === "grep") line = `Grep ${target}`;
  else if (tool === "glob") line = `Glob ${target}`;
  else {
    const name = tool ? tool.charAt(0).toUpperCase() + tool.slice(1) : "Step";
    line = `${name} ${target}`;
  }
  if (event.additions != null || event.deletions != null) {
    line += ` (+${event.additions ?? 0} -${event.deletions ?? 0})`;
  } else if (event.status === "error") {
    line += " ✗";
  } else if (event.status === "completed" && (tool === "bash" || tool === "shell")) {
    line += " ✓";
  }
  return line;
}

interface Parsed {
  text: string;
  model?: string;
  trying?: string;
  /** All TRYING markers seen in this push (order preserved). */
  tryings?: string[];
  limit?: string;
  free?: boolean;
  /** All ACTIVITY markers seen in this push (order preserved). */
  activities?: ActivityEvent[];
}

function parseActivityJson(raw: string): ActivityEvent | null {
  try {
    const parsed = JSON.parse(raw) as ActivityEvent;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    if (
      parsed.kind !== "tool" &&
      parsed.kind !== "text" &&
      parsed.kind !== "step" &&
      parsed.kind !== "patch"
    ) {
      return null;
    }
    if (
      parsed.status !== "running" &&
      parsed.status !== "completed" &&
      parsed.status !== "error" &&
      parsed.status !== "interrupted"
    ) {
      return null;
    }
    return {
      id: parsed.id,
      kind: parsed.kind,
      status: parsed.status,
      tool: typeof parsed.tool === "string" ? parsed.tool : undefined,
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      detail: typeof parsed.detail === "string" ? parsed.detail : undefined,
      output: typeof parsed.output === "string" ? parsed.output : undefined,
      path: typeof parsed.path === "string" ? parsed.path : undefined,
      additions:
        typeof parsed.additions === "number" && Number.isFinite(parsed.additions)
          ? parsed.additions
          : undefined,
      deletions:
        typeof parsed.deletions === "number" && Number.isFinite(parsed.deletions)
          ? parsed.deletions
          : undefined,
    };
  } catch {
    return null;
  }
}

function markerValue(inner: string): {
  model?: string;
  trying?: string;
  limit?: string;
  free?: boolean;
  activity?: ActivityEvent;
} {
  if (inner.startsWith("MODEL:")) return { model: inner.slice(6) };
  if (inner.startsWith("TRYING:")) return { trying: inner.slice(7) };
  if (inner.startsWith("LIMIT:")) return { limit: inner.slice(6) };
  if (inner.startsWith("FREE:")) return { free: true };
  if (inner.startsWith("ACTIVITY:")) {
    const activity = parseActivityJson(inner.slice(9));
    return activity ? { activity } : {};
  }
  return {};
}

const KNOWN_PREFIXES = [
  MODEL_PREFIX,
  TRYING_PREFIX,
  LIMIT_PREFIX,
  FREE_PREFIX,
  ACTIVITY_PREFIX,
];

// Incremental parser that strips markers from arbitrarily split chunks.
export class ModelMarkerParser {
  private buffer = "";
  private inMarker = false;

  push(chunk: string): Parsed {
    this.buffer += chunk;
    let text = "";
    let model: string | undefined;
    let trying: string | undefined;
    const tryings: string[] = [];
    let limit: string | undefined;
    let free: boolean | undefined;
    const activities: ActivityEvent[] = [];

    const takeTrying = (value: string | undefined) => {
      if (!value) return;
      trying = value;
      tryings.push(value);
    };

    const takeParsed = (parsed: ReturnType<typeof markerValue>) => {
      if (parsed.model) model = parsed.model;
      takeTrying(parsed.trying);
      if (parsed.limit !== undefined) limit = parsed.limit;
      if (parsed.free !== undefined) free = parsed.free;
      if (parsed.activity) activities.push(parsed.activity);
    };

    while (this.buffer) {
      if (this.inMarker) {
        const close = this.buffer.indexOf(MARK, 1);
        if (close === -1) {
          return {
            text,
            model,
            trying,
            tryings: tryings.length ? tryings : undefined,
            limit,
            free,
            activities: activities.length ? activities : undefined,
          };
        }
        const inner = this.buffer.slice(1, close);
        this.buffer = this.buffer.slice(close + 1);
        this.inMarker = false;
        takeParsed(markerValue(inner));
        continue;
      }
      const start = this.buffer.indexOf(MARK);
      if (start === -1) {
        text += this.buffer;
        this.buffer = "";
        return {
          text,
          model,
          trying,
          tryings: tryings.length ? tryings : undefined,
          limit,
          free,
          activities: activities.length ? activities : undefined,
        };
      }
      text += this.buffer.slice(0, start);
      const tail = this.buffer.slice(start);
      if (KNOWN_PREFIXES.some((prefix) => tail.startsWith(prefix))) {
        const close = tail.indexOf(MARK, 1);
        if (close === -1) {
          this.buffer = tail;
          this.inMarker = true;
          return {
            text,
            model,
            trying,
            tryings: tryings.length ? tryings : undefined,
            limit,
            free,
            activities: activities.length ? activities : undefined,
          };
        }
        const inner = tail.slice(1, close);
        this.buffer = tail.slice(close + 1);
        takeParsed(markerValue(inner));
        continue;
      }
      if (KNOWN_PREFIXES.some((prefix) => prefix.startsWith(tail))) {
        // Partial marker start split across chunks — wait for more.
        this.buffer = tail;
        this.inMarker = true;
        return {
          text,
          model,
          trying,
          tryings: tryings.length ? tryings : undefined,
          limit,
          free,
          activities: activities.length ? activities : undefined,
        };
      }
      // Unknown marker — drop the delimiter, keep the rest.
      this.buffer = tail.slice(1);
    }
    return {
      text,
      model,
      trying,
      tryings: tryings.length ? tryings : undefined,
      limit,
      free,
      activities: activities.length ? activities : undefined,
    };
  }

  flush(): string {
    const text = this.buffer;
    this.buffer = "";
    this.inMarker = false;
    return text;
  }
}
