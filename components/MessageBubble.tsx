"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, Pencil, RefreshCw } from "lucide-react";
import "highlight.js/styles/github.css";
import SummaryCard from "./SummaryCard";
import ImageViewer from "./ImageViewer";
import type { ConcludeResult } from "@/lib/types";
import { STR, useUiLang } from "@/lib/i18n";
import { modelLabel } from "@/lib/modelLabels";

interface Message {
  id: number;
  role: "user" | "model";
  text: string;
  image?: { mimeType: string; data: string };
  streaming?: boolean;
  failed?: boolean;
  model?: string;
  trying?: string;
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

export default function MessageBubble({
  messages,
  guest = false,
  summary = null,
  onRevert,
  onEdit,
  onRegenerate,
  onShare,
  canAct = true,
  editingId = null,
  editingText = "",
  onEditingText,
  onEditSave,
  onEditCancel,
}: {
  messages: Message[];
  guest?: boolean;
  summary?: { result: ConcludeResult; sourceText: string } | null;
  onRevert?: (id: number) => void;
  onEdit?: (id: number) => void;
  onRegenerate?: (id: number) => void;
  onShare?: (id: number) => void;
  canAct?: boolean;
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
      {messages.map((message, index) => {
        const imageUrl = message.image ? dataUrl(message.image) : null;
        const splitImage =
          message.role === "user" && imageUrl && message.text ? imageUrl : null;
        const isEditing = editingId === message.id;
        return (
        <div key={message.id} className={`message ${message.role}`}>
          <div className="message-body">
            {isEditing ? (
              <div className="bubble edit-bubble">
                <textarea
                  className="edit-input"
                  value={editingText}
                  onChange={(event) => onEditingText?.(event.target.value)}
                  aria-label="Edit message"
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
            ) : splitImage ? (
              <>
                <div className="bubble image-only">
                  <img
                    src={splitImage}
                    alt="Uploaded"
                    onClick={() => setViewer(splitImage)}
                  />
                </div>
                <div className="bubble">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {preserveLineBreaks(message.text)}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <div className="bubble">
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt="Uploaded"
                    onClick={() => setViewer(imageUrl)}
                  />
                )}
                {message.text && (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {preserveLineBreaks(message.text)}
                  </ReactMarkdown>
                )}
                {message.streaming && !message.text && (
                  <span className="thinking">
                    {!message.trying && message.model && (
                      <span className="thinking-label">{t["thinking"]}</span>
                    )}
                    <span className="thinking-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
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
                {!message.failed && message.model && (
                  <div className={`model-meta${message.streaming ? " live" : ""}`}>
                    {!message.streaming && message.elapsed !== undefined && (
                      <span>{message.elapsed}s · </span>
                    )}
                    <span>{modelLabel(message.model)}</span>
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
      {summary && (
        <SummaryCard
          result={summary.result}
          sourceText={summary.sourceText}
          guest={guest}
        />
      )}
      <div ref={endRef} />
      {viewer && (
        <ImageViewer src={viewer} alt="Uploaded" onClose={() => setViewer(null)} />
      )}
    </main>
  );
}
