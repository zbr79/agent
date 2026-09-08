"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, ChevronDown, Copy, Pencil, RefreshCw } from "lucide-react";
import "highlight.js/styles/github.css";
import ImageViewer from "./ImageViewer";
import { STR, useUiLang } from "@/lib/i18n";
import { modelLabel } from "@/lib/modelLabels";
import { formatElapsed } from "@/lib/format";

interface Message {
  id: number;
  role: "user" | "model";
  text: string;
  images?: { mimeType: string; data: string }[];
  streaming?: boolean;
  failed?: boolean;
  model?: string;
  trying?: string;
  processSteps?: string[];
  elapsed?: number;
}

function dataUrl(image: { mimeType: string; data: string }): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

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
        {shown.map((item, index) => (
          <span key={`${index}-${item}`} className="trail-line">{`→ ${item}`}</span>
        ))}
      </span>
      {expandable && (
        <ChevronDown size={13} className="trail-chevron" aria-hidden="true" />
      )}
    </button>
  );
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
  editingId = null,
  editingText = "",
  onEditingText,
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
  editingId?: number | null;
  editingText?: string;
  onEditingText?: (text: string) => void;
  onEditSave?: (id: number) => void;
  onEditCancel?: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const lang = useUiLang();
  const t = STR[lang];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        title={copiedId === message.id ? t["actions.copied"] : t["actions.copy"]}
        aria-label={t["actions.copy"]}
        onClick={() => copy(message)}
      >
        {copiedId === message.id ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {!isModel && onEdit && (
        <button
          type="button"
          className="action-button"
          title={t["actions.edit"]}
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
          title={t["actions.regenerate"]}
          aria-label={t["actions.regenerate"]}
          onClick={() => onRegenerate(message.id)}
        >
          <RefreshCw size={13} />
        </button>
      )}
    </>
  );

  if (messages.length === 0) {
    return <main className="messages" />;
  }

  return (
    <main className="messages">
      {messages.map((message) => {
        const imageUrls = (message.images ?? []).map((image) => dataUrl(image));
        const splitImages =
          message.role === "user" && imageUrls.length > 0 && message.text
            ? imageUrls
            : null;
        const isEditing = editingId === message.id;
        const segments = splitSegments(message.text ?? "");
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
          message.streaming && segments.length === 0 && message.role === "model";
        return (
        <div
          key={message.id}
          id={`msg-${message.id}`}
          className={`message ${message.role}${message.role === "model" ? " transcript" : ""}${flashId === message.id ? " flash" : ""}`}
        >
          <div className="message-body">
            {isEditing ? (
              <div className="bubble edit-bubble">
                <textarea
                  className="edit-input"
                  value={editingText}
                  onChange={(event) => onEditingText?.(event.target.value)}
                   aria-label={t["actions.edit"]}
                />
                <div className="edit-actions">
                  <button
                    type="button"
                    className="edit-save"
                    onClick={() => onEditSave?.(message.id)}
                    disabled={!editingText.trim()}
                  >
                    {t["actions.save"]}
                  </button>
                  <button
                    type="button"
                    className="edit-cancel"
                    onClick={() => onEditCancel?.()}
                  >
                    {t["actions.cancel"]}
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
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {preserveLineBreaks(message.text)}
                  </ReactMarkdown>
                </div>
              </>
            ) : message.role === "model" ? (
              <div className="transcript-entry">
                {imageUrls.map((url, imageIndex) => (
                  <img
                    key={imageIndex}
                    src={url}
                    alt={t["composer.uploadedAlt"]}
                    onClick={() => setViewer(url)}
                  />
                ))}
                {processWaiting && (
                  <div className="process-panel" aria-live="polite">
                    <span className="thinking">
                      <span className="thinking-label">
                        {t["process.working"] || t["thinking"]}
                      </span>
                      <span className="thinking-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    </span>
                  </div>
                )}
                {segments.map((segment, index) =>
                  segment.type === "wave" ? (
                    <TrailWave
                      key={`w${index}`}
                      items={segment.items}
                      active={message.streaming && index === segments.length - 1}
                    />
                  ) : (
                    <div key={`p${index}`} className="transcript-body">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                      >
                        {preserveLineBreaks(segment.text)}
                      </ReactMarkdown>
                    </div>
                  )
                )}
                {message.streaming && segments.length > 0 && <span className="cursor" />}
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
                {message.text && (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {preserveLineBreaks(message.text)}
                  </ReactMarkdown>
                )}
                {message.streaming && message.text && <span className="cursor" />}
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
                  (message.model ||
                    (!message.streaming && message.elapsed !== undefined)) && (
                  <div className={`model-meta${message.streaming ? " live" : ""}`}>
                    {message.elapsed !== undefined && !message.streaming && (
                      <span>
                        {formatElapsed(message.elapsed)}s
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
