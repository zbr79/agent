"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ArrowUp, Check, ChevronDown, Copy, Pencil, RefreshCw, X } from "lucide-react";
import "highlight.js/styles/github.css";
import ImageViewer from "./ImageViewer";
import ToolCallGroup, {
  buildActivityQueues,
  takeMatchedActivities,
} from "./ToolCallCards";
import ChangesSummary from "./ChangesSummary";
import { type ActivityItem } from "./ActivityPanel";
import { STR, useUiLang } from "@/lib/i18n";
import { modelLabel } from "@/lib/modelLabels";
import { formatElapsed, stripDoneLines } from "@/lib/format";
import { toWorkspaceRelative } from "@/lib/workspacePath";
import type { ActivityEvent } from "@/lib/markers";
import type { DocumentAttachment } from "@/lib/documents/types";

interface Message {
  id: number;
  role: "user" | "model";
  text: string;
  command?: "commit-push";
  images?: { mimeType: string; data: string }[];
  documents?: DocumentAttachment[];
  streaming?: boolean;
  failed?: boolean;
  model?: string;
  trying?: string;
  processSteps?: string[];
  activities?: ActivityEvent[];
  elapsed?: number;
}

function dataUrl(image: { mimeType: string; data: string }): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function documentType(document: DocumentAttachment): string {
  const extension = document.name.split(".").pop()?.toUpperCase();
  return extension || document.mimeType.split("/").pop()?.toUpperCase() || "FILE";
}

function DocumentChips({ documents }: { documents?: DocumentAttachment[] }) {
  if (!documents?.length) return null;
  return (
    <div className="message-document-chips">
      {documents.map((document) => (
        <span className="message-document-chip" key={document.id}>
          <strong>{documentType(document)}</strong>
          <span>{document.name}</span>
        </span>
      ))}
    </div>
  );
}

function isCommitPushCommand(message: Message, labels: Record<string, string>): boolean {
  return (
    message.role === "user" &&
    (message.command === "commit-push" ||
      message.text.trim() === labels["git.button"] ||
      message.text.trim() === "Commit & push" ||
      message.text.trim() === "提交并推送")
  );
}

// Initial render cap: on load we show only the tail so the window opens at the
// bottom without scrolling through the whole history. "Load earlier" grows it.
const INITIAL_WINDOW = 30;
const WINDOW_STEP = 30;

// Markdown collapses single newlines into spaces; convert them to hard
// breaks so the model's line-by-line format renders as separate lines.
function preserveLineBreaks(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.endsWith("  ") ? line : `${line}  `))
    .join("\n");
}

// Server mirrors tool activity as "→ Read foo.ts" lines inside the answer
// text. Consecutive tool lines form a "wave": while streaming, the wave shows
// only its latest line (each new command replaces the one before it), and once
// human-readable prose appears the wave commits as a single line and the next
// wave starts fresh below it.
const TRAIL_RE = /^\s*→\s+(.+)$/;

/** Legacy trail lines: file paths collapse to their basename (folder stays
 *  in the tooltip); URLs and non-path text are left untouched. */
function shortenTrailLine(label: string): string {
  return label.replace(
    /[\w.@+~\-/]*\/[\w.@+~\-/]*/g,
    (token: string, index: number, whole: string) => {
      const before = whole[index - 1] ?? "";
      if (before === ":" || token.includes("://")) return token;
      const core = token.replace(/\/+$/, "");
      if (!core.includes("/")) return token;
      const base = core.slice(core.lastIndexOf("/") + 1);
      if (!base) return token;
      return base + token.slice(core.length);
    }
  );
}

type Segment =
  | { type: "prose"; text: string }
  | { type: "wave"; items: string[] };

function splitSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  for (const raw of text.split("\n")) {
    const match = raw.match(TRAIL_RE);
    if (match) {
      const last = segments[segments.length - 1];
      if (last && last.type === "wave") last.items.push(match[1].trim());
      else segments.push({ type: "wave", items: [match[1].trim()] });
    } else if (raw.trim()) {
      const last = segments[segments.length - 1];
      if (last && last.type === "prose") last.text += `\n${raw}`;
      else segments.push({ type: "prose", text: raw });
    }
  }
  return segments;
}

function TrailWave({ items, active }: { items: string[]; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const expandable = items.length > 1;
  const shown = open ? items : items.slice(-1);
  return (
    <button
      type="button"
      className={`trail-wave${active ? " live" : ""}${expandable ? " expandable" : ""}${open ? " open" : ""}`}
      onClick={expandable ? () => setOpen((v) => !v) : undefined}
      aria-expanded={expandable ? open : undefined}
    >
      <span className="trail-lines">
        {shown.map((item, index) => {
          const clean = toWorkspaceRelative(item);
          return (
            <span
              key={`${index}-${item}`}
              className="trail-line"
              title={clean === shortenTrailLine(clean) ? undefined : clean}
            >{`→ ${shortenTrailLine(clean)}`}</span>
          );
        })}
      </span>
      {expandable && (
        <ChevronDown size={13} className="trail-chevron" aria-hidden="true" />
      )}
    </button>
  );
}

function langFromChildren(children: ReactNode): string {
  for (const child of Children.toArray(children)) {
    if (isValidElement<{ className?: string }>(child)) {
      const match = /language-([\w-]+)/.exec(child.props.className || "");
      if (match) return match[1];
    }
  }
  return "";
}

function MarkdownPre({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const lang = langFromChildren(children);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preRef.current?.innerText ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return (
    <div className="md-pre">
      <div className="md-pre-bar">
        <span className="md-pre-lang">{lang || "text"}</span>
        <button
          type="button"
          className={`md-pre-copy${copied ? " copied" : ""}`}
          onClick={copy}
          aria-label="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

const MARKDOWN_COMPONENTS = { pre: MarkdownPre };

// The agent's own "Files changed: a.ts, b.ts" manifest line — redundant next
// to the ChangesSummary card, so it is dropped from the rendered prose.
function normalizedHeader(line: string): { hit: boolean; tail: string } | null {
  const unbold = line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>+\s*/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^[-*+•]\s+/, "")
    .replace(/[*`_]/g, "");
  const match =
    /^\s*(files?\s+changed|changed\s+files|modified\s+files|files?\s+edited|edited\s+files|修改的文件|变更的文件|已修改文件(?:列表)?|文件(?:改动|变更|修改)情况?)\s*[:：]?\s*(.*)$/i.exec(
      unbold
    );
  if (!match) return null;
  return { hit: true, tail: match[2].trim() };
}

function isPathListLine(line: string): boolean {
  const cleaned = line
    .trim()
    .replace(/^[-*+•]\s+/, "")
    .replace(/[*`_]/g, "")
    .replace(/[,;]\s*$/, "");
  if (!cleaned) return false;
  const tokens = cleaned
    .split(/[,;、]|\s+and\s+/i)
    .map((token) =>
      // allow a trailing note: "lib/db.ts — added persistence"
      token.replace(/\s*[-–—:]\s*.*$/, "").trim()
    )
    .filter(Boolean);
  if (!tokens.length) return false;
  return tokens.every(
    (token) =>
      /^[\w\-./\\~+]+$/.test(token) && (token.includes("/") || /\.[\w-]{1,8}$/.test(token))
  );
}

export function stripChangesManifest(text: string): string {
  const lines = text.split("\n");
  const keep: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = normalizedHeader(lines[i]);
    const tail = header?.tail ?? "";
    if (header?.hit && (!tail || isPathListLine(tail))) {
      i += 1;
      while (i < lines.length) {
        if (!lines[i].trim()) {
          let ahead = i + 1;
          while (ahead < lines.length && !lines[ahead].trim()) ahead += 1;
          if (ahead < lines.length && isPathListLine(lines[ahead])) {
            i = ahead;
            continue;
          }
          break;
        }
        if (isPathListLine(lines[i])) {
          i += 1;
          continue;
        }
        break;
      }
      continue;
    }
    keep.push(lines[i]);
    i += 1;
  }
  return keep.join("\n").replace(/\n{3,}/g, "\n\n");
}

export default function MessageBubble({
  messages,
  guest = false,
  onRevert,
  onEdit,
  onRegenerate,
  onShare,
  canAct = true,
  flashId = null,
  activities = null,
  activityMessageId = null,
  editingId = null,
  editingText = "",
  editingImages,
  editingError = null,
  editingBusy = false,
  onEditingText,
  onEditingImages,
  onEditSave,
  onEditCancel,
}: {
  messages: Message[];
  guest?: boolean;
  onRevert?: (id: number) => void;
  onEdit?: (id: number) => void;
  onRegenerate?: (id: number) => void;
  onShare?: (id: number) => void;
  canAct?: boolean;
  flashId?: number | null;
  activities?: ActivityItem[] | null;
  activityMessageId?: number | null;
  editingId?: number | null;
  editingText?: string;
  editingImages?: Message["images"];
  editingError?: string | null;
  editingBusy?: boolean;
  onEditingText?: (text: string) => void;
  onEditingImages?: (images: Message["images"]) => void;
  onEditSave?: (id: number) => void;
  onEditCancel?: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const didScrollRef = useRef(false);
  const pinnedRef = useRef(true);
  const ignoreScrollUntilRef = useRef(0);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_WINDOW);
  const hiddenCount = Math.max(0, messages.length - visibleCount);
  const visible = hiddenCount > 0 ? messages.slice(hiddenCount) : messages;
  const [viewer, setViewer] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const lang = useUiLang();
  const t = STR[lang];

  useEffect(() => {
    const input = editInputRef.current;
    if (!input || editingId === null) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }, [editingId]);

  useEffect(() => {
    const input = editInputRef.current;
    if (!input || editingId === null) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }, [editingId, editingText]);

  // The real scrollable ancestor can be .main or .app-center depending on
  // which one gets stretched; only count it once it actually overflows.
  const getScroller = (): HTMLElement | null => {
    let el: HTMLElement | null = containerRef.current?.parentElement ?? null;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  };

  const scrollToBottom = (smooth: boolean) => {
    if (smooth) ignoreScrollUntilRef.current = Date.now() + 700;
    const scroller = getScroller();
    if (scroller) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    } else {
      endRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
    }
  };

  useLayoutEffect(() => {
    // Anchor to the bottom of the newest reply, not the last prompt. Base64
    // images decode after this first paint, so a ResizeObserver below keeps
    // re-pinning until the layout settles. Only later appends scroll smoothly.
    if (pinnedRef.current) scrollToBottom(didScrollRef.current);
    didScrollRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const metrics = () => {
      const el = getScroller() ?? document.scrollingElement ?? document.documentElement;
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    };

    const onScroll = () => {
      if (Date.now() < ignoreScrollUntilRef.current) return;
      pinnedRef.current = metrics() < 160;
    };
    // User intent wins immediately, even mid smooth-scroll animation.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        ignoreScrollUntilRef.current = 0;
        pinnedRef.current = false;
      } else if (metrics() < 160) {
        pinnedRef.current = true;
      }
    };
    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? null;
      if (touchY != null && y != null && y > touchY + 4) {
        ignoreScrollUntilRef.current = 0;
        pinnedRef.current = false;
      }
      touchY = y;
    };
    const onResize = () => {
      if (pinnedRef.current) scrollToBottom(false);
    };

    // Image decode / font swap / code highlighting grow the layout after the
    // initial pin; snap straight back to the reply bottom while pinned.
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom(false);
    });
    observer.observe(container);
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", onScroll, { capture: true });
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(null), 1600);
    } catch {}
  };

  const renderButtons = (isModel: boolean, message: Message) => (
    <>
      <button
        type="button"
        className={`action-button${copiedId === message.id ? " copied" : ""}`}
        aria-label={copiedId === message.id ? t["actions.copied"] : t["actions.copy"]}
        onClick={() => copy(message)}
      >
        {copiedId === message.id ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {!isModel && onEdit && (
        <button
          type="button"
          className="action-button"
          aria-label={t["actions.edit"]}
          onClick={() => onEdit(message.id)}
        >
          <Pencil size={13} />
        </button>
      )}
      {isModel && !message.failed && onRegenerate && (
        <button
          type="button"
          className="action-button"
          aria-label={t["actions.regenerate"]}
          onClick={() => onRegenerate(message.id)}
        >
          <RefreshCw size={13} />
        </button>
      )}
    </>
  );

  if (messages.length === 0) {
    return <main ref={containerRef} className="messages" />;
  }

  return (
    <main ref={containerRef} className="messages">
      {hiddenCount > 0 && (
        <button
          type="button"
          className="load-earlier"
          onClick={() => setVisibleCount((c) => c + WINDOW_STEP)}
        >
          {t["messages.loadEarlier"].replace("{count}", String(hiddenCount))}
        </button>
      )}
      {visible.map((message, visibleIndex) => {
        const imageUrls = (message.images ?? []).map((image) => dataUrl(image));
        const commandMessage = isCommitPushCommand(message, t);
        const previousMessage = visible[visibleIndex - 1];
        const commandResult =
          message.role === "model" &&
          previousMessage != null &&
          isCommitPushCommand(previousMessage, t);
        const splitImages =
          message.role === "user" && imageUrls.length > 0 && message.text
            ? imageUrls
            : null;
        const isEditing = editingId === message.id;
        const editImages = editingImages ?? message.images ?? [];
        // Live run's global activity list wins for the in-flight message;
        // every other message reads its own persisted activities, so cards
        // and the changes summary survive refreshes.
        const liveActivities =
          message.id === activityMessageId && activities?.length ? activities : null;
        const effectiveActivities =
          liveActivities ?? (message.activities?.length ? message.activities : null);
        // Rebuilt every render; consumed in deterministic segment order below.
        const activityQueues = effectiveActivities
          ? buildActivityQueues(effectiveActivities)
          : null;
        const segments = splitSegments(
          message.role === "model"
            ? stripDoneLines(message.text ?? "")
            : message.text ?? ""
        );
        if (
          message.role === "model" &&
          !segments.some((segment) => segment.type === "wave")
        ) {
          const steps = (message.processSteps ?? [])
            .map((step) => step.trim())
            .filter(Boolean);
          if (steps.length) segments.unshift({ type: "wave", items: steps });
        }
        const processWaiting =
          message.streaming &&
          message.role === "model" &&
          !segments.some((segment) => segment.type === "prose");
        return (
        <div
          key={message.id}
          id={`msg-${message.id}`}
          className={`message ${message.role}${message.role === "model" ? " transcript" : ""}${commandMessage ? " command-message" : ""}${commandResult ? " command-result" : ""}${flashId === message.id ? " flash" : ""}`}
        >
          <div className="message-body">
            {isEditing ? (
              <div className="bubble edit-bubble">
                {editImages.length > 0 && (
                  <div className="edit-images">
                    {editImages.map((image, imageIndex) => {
                      const url = dataUrl(image);
                      return (
                        <div key={imageIndex} className="edit-image">
                          <img
                            src={url}
                            alt={t["composer.uploadedAlt"]}
                            onClick={() => setViewer(url)}
                          />
                          <button
                            type="button"
                            className="image-remove"
                            onClick={() =>
                              onEditingImages?.(
                                editImages.filter((_, index) => index !== imageIndex)
                              )
                            }
                            aria-label={t["composer.removeImage"]}
                          >
                            <X size={14} strokeWidth={2.5} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <textarea
                  ref={editInputRef}
                  className="edit-input"
                  value={editingText}
                  onChange={(event) => onEditingText?.(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onEditCancel?.();
                    } else if (
                      event.key === "Enter" &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.preventDefault();
                      onEditSave?.(message.id);
                    }
                  }}
                  aria-label={t["actions.edit"]}
                />
                {editingError && <p className="edit-error">{editingError}</p>}
                <div className="edit-actions">
                  <button
                    type="button"
                    className="edit-cancel"
                    onClick={() => onEditCancel?.()}
                  >
                    {t["actions.cancel"]}
                  </button>
                  <button
                    type="button"
                    className="edit-save edit-send"
                    onClick={() => onEditSave?.(message.id)}
                    aria-label={t["composer.send"]}
                    aria-busy={editingBusy}
                  >
                    {editingBusy ? t["actions.restoring"] : t["composer.send"]}
                  </button>
                </div>
              </div>
            ) : splitImages ? (
              <>
                {splitImages.map((url, imageIndex) => (
                  <div key={imageIndex} className="bubble image-only">
                    <img
                      src={url}
                       alt={t["composer.uploadedAlt"]}
                      onClick={() => setViewer(url)}
                    />
                  </div>
                ))}
                <div className="bubble">
                  <DocumentChips documents={message.documents} />
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={MARKDOWN_COMPONENTS}
                  >
                    {preserveLineBreaks(message.text)}
                  </ReactMarkdown>
                </div>
              </>
            ) : message.role === "model" ? (
              <div className="transcript-entry">
                {commandResult && !message.streaming && message.elapsed !== undefined && (
                  <div className="command-worked">
                    {t["message.workedFor"]} {formatElapsed(message.elapsed, lang)}
                  </div>
                )}
                {imageUrls.map((url, imageIndex) => (
                  <img
                    key={imageIndex}
                    src={url}
                    alt={t["composer.uploadedAlt"]}
                    onClick={() => setViewer(url)}
                  />
                ))}
                <DocumentChips documents={message.documents} />
                {processWaiting && (
                  <div className="process-panel" aria-live="polite">
                    <span
                      className="thinking"
                      role="status"
                      aria-label={t["process.working"] || t["thinking"]}
                    >
                      <span className="thinking-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    </span>
                  </div>
                )}
                {segments.map((segment, index) => {
                  if (segment.type === "wave") {
                    let matched: ActivityItem[] = [];
                    let rest = segment.items;
                    if (activityQueues) {
                      const taken = takeMatchedActivities(activityQueues, segment.items);
                      matched = taken.matched;
                      rest = taken.unmatched;
                    }
                    const waveActive = message.streaming && index === segments.length - 1;
                    return (
                      <Fragment key={`w${index}`}>
                        {matched.length ? (
                          <ToolCallGroup items={matched} active={waveActive} />
                        ) : null}
                        {rest.length ? (
                          <TrailWave items={rest} active={waveActive} />
                        ) : null}
                      </Fragment>
                    );
                  }
                  return (
                    <div key={`p${index}`} className="transcript-body">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={MARKDOWN_COMPONENTS}
                      >
                        {preserveLineBreaks(
                          stripChangesManifest(toWorkspaceRelative(segment.text))
                        )}
                      </ReactMarkdown>
                    </div>
                  );
                })}
                {effectiveActivities && !processWaiting ? (
                  <ChangesSummary items={effectiveActivities} />
                ) : null}
                {!message.streaming &&
                  !message.failed &&
                  !processWaiting &&
                  segments.length > 0 && (
                    <div className="done-rule" aria-hidden="true" />
                  )}
              </div>
            ) : commandMessage ? (
              <div className="bubble command-bubble" aria-label={message.text}>
                <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />
                <span>{message.text}</span>
              </div>
            ) : (
              <div className="bubble">
                {imageUrls.map((url, imageIndex) => (
                  <img
                    key={imageIndex}
                    src={url}
                    alt={t["composer.uploadedAlt"]}
                    onClick={() => setViewer(url)}
                  />
                ))}
                <DocumentChips documents={message.documents} />
                {message.text && (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={MARKDOWN_COMPONENTS}
                  >
                    {preserveLineBreaks(message.text)}
                  </ReactMarkdown>
                )}
              </div>
            )}
            {message.role === "model" ? (
              <div className="reply-footer">
                {canAct && !isEditing && !message.streaming && (
                  <div className="action-bar model-bar">
                    {renderButtons(true, message)}
                  </div>
                )}
                {!message.failed &&
                  !commandResult &&
                  (message.model ||
                    (!message.streaming && message.elapsed !== undefined)) && (
                  <div className={`model-meta${message.streaming ? " live" : ""}`}>
                    {message.elapsed !== undefined && !message.streaming && (
                      <span>
                        {t["message.finishedIn"]} {formatElapsed(message.elapsed, lang)}
                        {message.model ? " · " : ""}
                      </span>
                    )}
                    {message.model && <span>{modelLabel(message.model)}</span>}
                  </div>
                )}
              </div>
            ) : (
              canAct && !isEditing && !message.streaming && (
                <div className="action-bar">{renderButtons(false, message)}</div>
              )
            )}
          </div>
        </div>
        );
      })}
      <div ref={endRef} />
      {viewer && (
         <ImageViewer src={viewer} alt={t["composer.uploadedAlt"]} onClose={() => setViewer(null)} />
      )}
    </main>
  );
}
