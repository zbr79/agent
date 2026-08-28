"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import SummaryCard from "./SummaryCard";
import ImageViewer from "./ImageViewer";
import type { ConcludeResult } from "@/lib/types";

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
}: {
  messages: Message[];
  guest?: boolean;
  summary?: { result: ConcludeResult; sourceText: string } | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<string | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return <main className="messages" />;
  }

  return (
    <main className="messages">
      {messages.map((message, index) => {
        const imageUrl = message.image ? dataUrl(message.image) : null;
        return (
        <div key={message.id} className={`message ${message.role}`}>
          <div className="message-body">
            <div className="bubble">
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt="Uploaded"
                  onClick={() => setViewer(imageUrl)}
                />
              )}
              {message.text && (
                <ReactMarkdown>{preserveLineBreaks(message.text)}</ReactMarkdown>
              )}
              {message.streaming && !message.text && (
                <span className="thinking">
                  {!message.trying && message.model && (
                    <span className="thinking-label">Thinking…</span>
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
            {message.role === "model" && !message.failed && message.model && (
              <div className={`model-meta${message.streaming ? " live" : ""}`}>
                {!message.streaming && message.elapsed !== undefined && (
                  <span>{message.elapsed}s · </span>
                )}
                <span>{message.model}</span>
              </div>
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
