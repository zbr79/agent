"use client";

import { useRef, useState } from "react";
import { ArrowUp, Plus, Square, X } from "lucide-react";
import type { ChatImage } from "@/lib/types";
import { MAX_IMAGES } from "@/lib/types";
import { STR, useUiLang } from "@/lib/i18n";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface ComposerProps {
  sending: boolean;
  onSend: (text: string, images?: ChatImage[]) => void;
  onStop: () => void;
  disabled?: boolean;
  placeholder?: string;
}

function readImage(
  file: File,
  errors: { tooLarge: string; read: string }
): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error(errors.tooLarge));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [head, data] = dataUrl.split(",");
      const mimeType = head.match(/data:(.*?);/)?.[1] ?? file.type;
      resolve({ mimeType, data });
    };
    reader.onerror = () => reject(new Error(errors.read));
    reader.readAsDataURL(file);
  });
}

export default function Composer({ sending, onSend, onStop, disabled = false, placeholder }: ComposerProps) {
  const lang = useUiLang();
  const t = STR[lang];
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
      setImageError(t["composer.maxImages"].replace("{count}", String(MAX_IMAGES)));
    }
    try {
      const loaded: ChatImage[] = [];
      for (const file of selected) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          setImageError(t["composer.unsupportedImage"]);
          continue;
        }
        loaded.push(
          await readImage(file, {
            tooLarge: t["composer.imageTooLarge"],
            read: t["composer.readError"],
          })
        );
      }
      setImages((prev) => [...prev, ...loaded].slice(0, MAX_IMAGES));
      if (loaded.length > 0) setImageError(null);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : t["composer.readError"]);
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
               <img src={`data:${image.mimeType};base64,${image.data}`} alt={t["composer.previewAlt"]} />
              <button
                type="button"
                onClick={() => removeImage(index)}
                 aria-label={t["composer.removeImage"]}
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
           aria-label={t["composer.attachImage"]}
           title={t["composer.attachImage"]}
          disabled={images.length >= MAX_IMAGES || disabled}
        >
          <Plus size={18} />
        </button>
        <textarea
          rows={1}
          value={text}
           placeholder={placeholder ?? t["composer.placeholder"]}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
           aria-label={t["composer.message"]}
        />
        {sending ? (
           <button type="button" className="send-button" onClick={onStop} aria-label={t["composer.stop"]}>
            <Square size={15} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            className="send-button"
            onClick={handleSend}
            disabled={!canSend}
             aria-label={t["composer.send"]}
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
      {imageError && <p className="hint">{imageError}</p>}
    </div>
  );
}
