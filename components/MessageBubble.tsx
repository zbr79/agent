"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

interface Message {
  id: number;
  role: "user" | "model";
  text: string;
  image?: { mimeType: string; data: string };
  streaming?: boolean;
  failed?: boolean;
}

function dataUrl(image: { mimeType: string; data: string }): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

export default function MessageBubble({ messages }: { messages: Message[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <main className="messages">
        <p className="empty">
          Ask me anything, or attach an image
          <br />
          and I&apos;ll describe or analyze it.
        </p>
      </main>
    );
  }

  return (
    <main className="messages">
      {messages.map((message) => (
        <div key={message.id} className={`message ${message.role}`}>
          <div className="bubble">
            {message.image && <img src={dataUrl(message.image)} alt="Uploaded" />}
            {message.text && <ReactMarkdown>{message.text}</ReactMarkdown>}
            {message.streaming && !message.text && <span className="cursor" />}
            {message.streaming && message.text && <span className="cursor" />}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </main>
  );
}
