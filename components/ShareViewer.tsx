"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import type { ChatImage } from "@/lib/types";
import { modelLabel } from "@/lib/modelLabels";

interface SharedMessage {
  role: "user" | "model";
  text: string;
  image?: ChatImage;
  model?: string;
  elapsed?: number;
}

interface ShareViewerProps {
  share: {
    kind: "chat" | "message";
    title: string;
    messages: SharedMessage[];
    createdAt: string;
  } | null;
}

function preserveLineBreaks(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.endsWith("  ") ? line : `${line}  `))
    .join("\n");
}

export default function ShareViewer({ share }: ShareViewerProps) {
  if (!share) {
    return (
      <div className="share-page">
        <div className="share-missing">
          <h1>InsChat</h1>
          <p>This shared conversation is not available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="share-page">
      <header className="share-head">
        <h1>InsChat</h1>
        <h2>{share.title}</h2>
        <p className="share-meta">
          Shared {share.kind === "chat" ? "conversation" : "message"} ·{" "}
          {new Date(share.createdAt).toLocaleString()}
        </p>
      </header>
      <main className="share-messages">
        {share.messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <div className="message-body">
              {message.image && (
                <div className="bubble image-only">
                  <img
                    src={`data:${message.image.mimeType};base64,${message.image.data}`}
                    alt="Shared"
                  />
                </div>
              )}
              {message.text && (
                <div className="bubble">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {preserveLineBreaks(message.text)}
                  </ReactMarkdown>
                </div>
              )}
              {message.role === "model" && message.model && (
                <div className="model-meta">
                  {message.elapsed !== undefined && <span>{message.elapsed}s · </span>}
                  <span>{modelLabel(message.model)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
