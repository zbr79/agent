"use client";

import { useCallback, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";
import type { ChatImage, ChatMessage } from "@/lib/types";

interface UiMessage {
  id: number;
  role: "user" | "model";
  text: string;
  image?: ChatImage;
  streaming?: boolean;
  failed?: boolean;
}

let nextId = 1;

function toApiMessages(messages: UiMessage[]): ChatMessage[] {
  return messages
    .filter((message) => !message.failed && (message.text || message.image))
    .map(({ role, text, image }) => ({ role, text, image }));
}

export default function ChatApp() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string, image?: ChatImage) => {
      if (sending) return;

      const userMessage: UiMessage = { id: nextId++, role: "user", text, image };
      const modelMessage: UiMessage = {
        id: nextId++,
        role: "model",
        text: "",
        streaming: true,
      };
      const history = toApiMessages([...messages, userMessage]);
      setMessages((prev) => [...prev, userMessage, modelMessage]);
      setSending(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const body = await response.text();
          let error = "Chat request failed.";
          try {
            error = JSON.parse(body).error ?? error;
          } catch {}
          throw new Error(error);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((message) =>
              message.id === modelMessage.id
                ? { ...message, text: message.text + chunk }
                : message
            )
          );
        }
        setMessages((prev) =>
          prev.map((message) =>
            message.id === modelMessage.id ? { ...message, streaming: false } : message
          )
        );
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        setMessages((prev) =>
          prev.map((message) =>
            message.id === modelMessage.id
              ? {
                  ...message,
                  streaming: false,
                  failed: !aborted,
                  text: aborted
                    ? message.text
                    : message.text || (error instanceof Error ? error.message : "Chat request failed."),
                }
              : message
          )
        );
      } finally {
        setSending(false);
        abortRef.current = null;
      }
    },
    [messages, sending]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>GemChat</h1>
        <p>Powered by Google Gemini · text + images</p>
      </header>
      <MessageBubble messages={messages} />
      <Composer onSend={send} onStop={stop} sending={sending} />
    </div>
  );
}
