"use client";

import { useRef, useState } from "react";
import { ArrowUp, Plus, Square, X } from "lucide-react";
import type { ChatImage } from "@/lib/types";
import { MAX_IMAGES } from "@/lib/types";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface ComposerProps {
  sending: boolean;
  onSend: (text: string, images?: ChatImage[]) => void;
  onStop: () => void;
  disabled?: boolean;
  placeholder?: string;
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

export default function Composer({ sending, onSend, onStop, disabled = false, placeholder }: ComposerProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ChatImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSend = (text.trim().length > 0 || images.length > 0) && !sending && !disabled;

  const handleSend = () => {
    if (!canSend) return;
    onSend(text.trim(), images.length > 0 ? images : undefined);
    setText("");
    setImages([]);
    setImageError(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const room = MAX_IMAGES - images.length;
    const selected = files.slice(0, room);
    if (files.length > room) {
      setImageError(`最多只能添加 ${MAX_IMAGES} 张图片。`);
    }
    try {
      const loaded: ChatImage[] = [];
      for (const file of selected) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          setImageError("Only JPEG, PNG, and WebP images are supported.");
          continue;
        }
        loaded.push(await readImage(file));
      }
      setImages((prev) => [...prev, ...loaded].slice(0, MAX_IMAGES));
      if (loaded.length > 0) setImageError(null);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Could not read the image.");
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="composer">
      {images.length > 0 && (
        <div className="preview-grid">
          {images.map((image, index) => (
            <div key={index} className="preview">
              <img src={`data:${image.mimeType};base64,${image.data}`} alt="Preview" />
              <button
                type="button"
                onClick={() => removeImage(index)}
                aria-label="Remove image"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="input-row">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={handleFiles}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach image"
          title="Attach image"
          disabled={images.length >= MAX_IMAGES || disabled}
        >
          <Plus size={18} />
        </button>
        <textarea
          rows={1}
          value={text}
          placeholder={placeholder ?? ""}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Message"
        />
        {sending ? (
          <button type="button" className="send-button" onClick={onStop} aria-label="Stop">
            <Square size={15} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            className="send-button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
      {imageError && <p className="hint">{imageError}</p>}
    </div>
  );
}
