"use client";

import { useRef, useState } from "react";
import type { ChatImage } from "@/lib/types";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface ComposerProps {
  sending: boolean;
  onSend: (text: string, image?: ChatImage) => void;
  onStop: () => void;
}

function readImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error("Image is too large. Max size is 5 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [head, data] = dataUrl.split(",");
      const mimeType = head.match(/data:(.*?);/)?.[1] ?? file.type;
      resolve({ mimeType, data });
    };
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

export default function Composer({ sending, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<ChatImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSend = (text.trim().length > 0 || image !== null) && !sending;

  const handleSend = () => {
    if (!canSend) return;
    onSend(text.trim(), image ?? undefined);
    setText("");
    setImage(null);
    setImageError(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setImageError("Only JPEG, PNG, and WebP images are supported.");
      return;
    }
    try {
      setImage(await readImage(file));
      setImageError(null);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Could not read the image.");
    }
  };

  return (
    <div className="composer">
      {image && (
        <div className="preview">
          <img src={`data:${image.mimeType};base64,${image.data}`} alt="Preview" />
          <button
            type="button"
            onClick={() => setImage(null)}
            aria-label="Remove image"
          >
            ×
          </button>
        </div>
      )}
      <div className="input-row">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={handleFile}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach image"
          title="Attach image"
        >
          ＋
        </button>
        <textarea
          rows={1}
          value={text}
          placeholder=""
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Message"
        />
        {sending ? (
          <button type="button" className="send-button" onClick={onStop} aria-label="Stop">
            ■
          </button>
        ) : (
          <button
            type="button"
            className="send-button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send"
          >
            ↑
          </button>
        )}
      </div>
      {imageError && <p className="hint">{imageError}</p>}
    </div>
  );
}
