"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  ChevronDown,
  File,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileType,
  Lock,
  LoaderCircle,
  Mic,
  Plus,
  Square,
  X,
} from "lucide-react";
import type { DocumentAttachment } from "@/lib/documents/types";
import type { ChatImage, WorkspaceChanges } from "@/lib/types";
import { GUEST_MAX_AUDIO_MS, MAX_AUDIO_BYTES, USER_MAX_AUDIO_MS } from "@/lib/types";
import { MAX_ATTACHMENTS } from "@/lib/attachments/limits";
import { toastError } from "@/lib/toast";
import { STR, useUiLang } from "@/lib/i18n";
import {
  useChatMode,
  useCompressImages,
  useDeepSeekPeak,
  useSelectedModel,
  type ChatMode,
  type SelectedModel,
} from "@/lib/prefs";
import { compressImage } from "@/lib/imageCompress";
import {
  isVoiceInputSupported,
  recordVoice,
  VoiceInputError,
  type VoiceRecordHandle,
} from "@/lib/audioRecorder";
import DocumentPicker, { type DocumentPickerStatus } from "./DocumentPicker";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface ComposerProps {
  sending: boolean;
  stopping?: boolean;
  onSend: (
    text: string,
    images?: ChatImage[],
    displayText?: string,
    documents?: DocumentAttachment[],
    command?: "commit-push"
  ) => void;
  onStop: () => void;
  disabled?: boolean;
  placeholder?: string;
  signedIn?: boolean;
  onRequireAuth?: () => void;
  changes?: WorkspaceChanges | null;
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
      resolve({ mimeType, data, name: file.name });
    };
    reader.onerror = () => reject(new Error(errors.read));
    reader.readAsDataURL(file);
  });
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function Composer({
  sending,
  stopping = false,
  onSend,
  onStop,
  disabled = false,
  placeholder,
  signedIn = false,
  onRequireAuth,
  changes = null,
}: ComposerProps) {
  const lang = useUiLang();
  const t = STR[lang];
  const [compressOn] = useCompressImages();
  const [model, setModel] = useSelectedModel();
  const peak = useDeepSeekPeak();
  const [modelOpen, setModelOpen] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [mode, setMode] = useChatMode();
  const [text, setText] = useState("");
  const [multiLineText, setMultiLineText] = useState(false);
  const [images, setImages] = useState<ChatImage[]>([]);
  const [documents, setDocuments] = useState<DocumentAttachment[]>([]);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentStatus, setDocumentStatus] = useState<DocumentPickerStatus>({
    busy: false,
    progress: 0,
    phase: null,
    uploadNames: [],
    errors: [],
  });
  const [imageError, setImageError] = useState<string | null>(null);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "recording" | "transcribing">("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceRef = useRef<VoiceRecordHandle | null>(null);
  const autoSendRef = useRef(false);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const pickerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef(text);
  textRef.current = text;

  const handleDocumentStatus = useCallback((status: DocumentPickerStatus) => {
    setDocumentStatus(status);
  }, []);
  const showAttachmentError = useCallback((message: string) => {
    toastError(message);
  }, []);

  // Close the model picker on outside click / Escape.
  useEffect(() => {
    if (!modelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (pickerRef.current && !pickerRef.current.contains(target)) setModelOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [modelOpen]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (text.length === 0) {
      el.style.height = "";
      setMultiLineText(false);
      return;
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    const style = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight) || 21;
    const verticalPadding =
      (Number.parseFloat(style.paddingTop) || 0) +
      (Number.parseFloat(style.paddingBottom) || 0);
    setMultiLineText(el.scrollHeight > lineHeight + verticalPadding + 1);
  }, [text]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 560px)");
    const sync = () => setIsPhone(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    return () => {
      voiceRef.current?.cancel();
    };
  }, []);

  const modelLocked = peak && model === "deepseek-v4-flash";
  const modelKey =
    model === "gpt-6-luna"
      ? "luna"
      : model === "qwen3.8-flash"
        ? "qwen"
        : model === "glm-5.3-flash"
          ? "glm"
          : "ds";
  const effectiveMode: ChatMode = signedIn ? mode : "plan";
  const canSend =
    (text.trim().length > 0 || images.length > 0 || documents.length > 0) &&
    !sending &&
    !disabled &&
    !documentBusy;
  // During the voice flow the send button stays live: pressing it queues an
  // auto-send once the transcript lands.
  const voiceBusy = voiceStatus !== "idle" && !sending && !disabled;
  const shouldShowSendBusy = voiceStatus === "transcribing" && !sending && !disabled;
  const hint = voiceHint || imageError;

  const sendCommitPush = () => {
    if (disabled || sending) return;
    if (effectiveMode !== "build") setMode("build");
    onSend(t["git.prompt"], undefined, t["git.button"], undefined, "commit-push");
  };

  const handleSend = () => {
    if (disabled || sending) return;
    if (voiceStatus === "recording") {
      // One-click flow: stop the mic, transcribe, then send automatically.
      autoSendRef.current = true;
      setVoiceStatus("transcribing");
      voiceRef.current?.stop();
      return;
    }
    if (voiceStatus === "transcribing") {
      autoSendRef.current = true;
      return;
    }
    if (images.length > 0 && model === "deepseek-v4-flash") {
      setImageError(t["composer.imageUnsupportedModel"]);
      return;
    }
    if (!canSend) return;
    onSend(
      text.trim(),
      images.length > 0 ? images : undefined,
      undefined,
      documents.length > 0 ? documents : undefined
    );
    setText("");
    setImages([]);
    setDocuments([]);
    setImageError(null);
  };

  const insertAtCaret = (snippet: string): string => {
    const cleaned = snippet.trim();
    if (!cleaned) return textRef.current;
    const el = textareaRef.current;
    const current = textRef.current;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const padBefore = before.length > 0 && !/\s$/.test(before) ? " " : "";
    const padAfter = after.length > 0 && !/^\s/.test(after) ? " " : "";
    const insert = `${padBefore}${cleaned}${padAfter}`;
    const next = `${before}${insert}${after}`;
    setText(next);
    const caret = before.length + insert.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
    return next;
  };

  const insertNewline = () => {
    const el = textareaRef.current;
    if (!el) {
      setText((prev) => `${prev}\n`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = `${text.slice(0, start)}\n${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 1, start + 1);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
      return;
    }
    if (
      signedIn &&
      event.key === "Tab" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (event.shiftKey) {
        insertNewline();
      } else {
        setMode(mode === "build" ? "plan" : "build");
      }
    }
  };

  const handleImageFiles = async (files: File[]): Promise<number> => {
    if (files.length === 0) return 0;
    const room = MAX_ATTACHMENTS - images.length - documents.length;
    if (room <= 0) {
      showAttachmentError(t["composer.maxAttachmentsReached"]);
      return 0;
    }
    const selected = files.slice(0, room);
    if (files.length > room) {
      showAttachmentError(t["composer.maxAttachments"]);
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
      if (compressOn) {
        for (let i = 0; i < loaded.length; i++) {
          try {
            loaded[i] = await compressImage(loaded[i]);
          } catch {}
        }
      }
      setImages((prev) =>
        [...prev, ...loaded].slice(0, Math.max(0, MAX_ATTACHMENTS - documents.length))
      );
      if (loaded.length > 0) setImageError(null);
      return loaded.length;
    } catch (error) {
      setImageError(error instanceof Error ? error.message : t["composer.readError"]);
      return 0;
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const documentInfo = (document: DocumentAttachment) => {
    const extension = document.name.split(".").pop()?.toLowerCase();
    if (extension === "xlsx") {
      return { Icon: FileSpreadsheet, label: lang === "zh" ? "电子表格" : "Spreadsheet", tone: "xlsx" };
    }
    if (extension === "docx") {
      return { Icon: FileType, label: lang === "zh" ? "Word 文档" : "Word document", tone: "docx" };
    }
    if (extension === "pdf") {
      return { Icon: FileText, label: lang === "zh" ? "PDF 文档" : "PDF document", tone: "pdf" };
    }
    if (extension === "txt") {
      return { Icon: FileCode2, label: lang === "zh" ? "文本文件" : "Text file", tone: "txt" };
    }
    return { Icon: File, label: lang === "zh" ? "文件" : "File", tone: "file" };
  };

  const transcribe = async (blob: Blob, durationMs: number) => {
    if (blob.size > MAX_AUDIO_BYTES) {
      setVoiceHint(t["composer.audioTooLarge"]);
      setVoiceStatus("idle");
      return;
    }
    setVoiceStatus("transcribing");
    const shouldAutoSend = autoSendRef.current;
    autoSendRef.current = false;
    const body = new FormData();
    body.append("file", blob, "dictation.wav");
    body.append("language", "auto");
    body.append("durationMs", String(durationMs));
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body,
        credentials: "same-origin",
        signal: AbortSignal.timeout(240000),
      });
      const payload = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (response.status === 503) {
        setVoiceHint(t["composer.transcribeUnavailable"]);
        return;
      }
      if (response.status === 413) {
        setVoiceHint(t["composer.audioTooLarge"]);
        return;
      }
      if (!response.ok) {
        setVoiceHint(null);
        return;
      }
      const transcript = payload?.text?.trim() ?? "";
      if (!transcript) {
        // Silent / no-speech recording: show nothing, send nothing.
        setVoiceHint(null);
        return;
      }
      const merged = insertAtCaret(transcript);
      setVoiceHint(null);
      if (shouldAutoSend) {
        const imgs = imagesRef.current;
        const trimmed = merged.trim();
        if (trimmed || imgs.length > 0) {
          const docs = documentsRef.current;
          onSend(
            trimmed,
            imgs.length > 0 ? imgs : undefined,
            undefined,
            docs.length > 0 ? docs : undefined
          );
          setText("");
          setImages([]);
          setDocuments([]);
          setImageError(null);
        }
      }
    } catch {
      setVoiceHint(null);
    } finally {
      setVoiceStatus("idle");
    }
  };

  const startRecording = () => {
    if (disabled || voiceStatus !== "idle") return;
    if (!isVoiceInputSupported()) {
      setVoiceHint(t["composer.micUnsupported"]);
      return;
    }
    setVoiceHint(null);
    setElapsedMs(0);
    const handle = recordVoice({
      maxMs: signedIn ? USER_MAX_AUDIO_MS : GUEST_MAX_AUDIO_MS,
      onTick: setElapsedMs,
    });
    voiceRef.current = handle;
    setVoiceStatus("recording");
    void handle.result
      .then((recording) => {
        if (voiceRef.current !== handle) return;
        voiceRef.current = null;
        void transcribe(recording.blob, recording.durationMs);
      })
      .catch((error: unknown) => {
        if (voiceRef.current !== handle) return;
        voiceRef.current = null;
        setVoiceStatus("idle");
        if (error instanceof VoiceInputError && error.code === "cancelled") return;
        if (error instanceof VoiceInputError && error.code === "unsupported") {
          setVoiceHint(t["composer.micUnsupported"]);
          return;
        }
        if (error instanceof VoiceInputError && error.code === "denied") {
          setVoiceHint(t["composer.micDenied"]);
          return;
        }
        setVoiceHint(null);
      });
  };

  const handleMic = () => {
    if (voiceStatus === "recording") {
      // The spinning ring on the mic button is the only "transcribing"
      // indicator; no text hints.
      setVoiceStatus("transcribing");
      voiceRef.current?.stop();
      return;
    }
    if (voiceStatus === "transcribing") return;
    startRecording();
  };

  const micLabel =
    voiceStatus === "recording"
      ? t["composer.stopRecording"]
      : voiceStatus === "transcribing"
        ? t["composer.transcribing"]
        : t["composer.record"];

  const composerExpanded =
    multiLineText ||
    images.length > 0 ||
    documents.length > 0 ||
    documentStatus.busy ||
    voiceStatus !== "idle";
  // Phones never switch to the footer layout: the pickers stay inline and the
  // model pill stays in its own row under the bubble, so growing the input
  // cannot make controls jump around.
  const useFooter = composerExpanded && !isPhone;

  const modeToggle = (
    <div className="composer-mode" role="group" aria-label={t["composer.mode"]}>
      {(["build", "plan"] as ChatMode[]).map((value) => (
        <button
          key={value}
          type="button"
          className={`composer-mode-btn composer-mode-btn-${value}${effectiveMode === value ? " active" : ""}${value === "build" && !signedIn ? " locked" : ""}`}
          onClick={() => {
            if (value === "build" && !signedIn) {
              onRequireAuth?.();
              return;
            }
            setMode(value);
          }}
          disabled={disabled}
          aria-pressed={signedIn && effectiveMode === value}
          aria-disabled={value === "build" && !signedIn}
          aria-label={
            value === "build" && !signedIn
              ? t["composer.mode.buildLogin"]
              : t[`composer.mode.${value}`]
          }
        >
          {t[`composer.mode.${value}`]}
        </button>
      ))}
    </div>
  );

  const modelPicker = (
    <div className="composer-picker" ref={pickerRef}>
      <button
        type="button"
        className={`composer-reasoning composer-model-pill${modelOpen ? " open" : ""}${modelLocked ? " locked" : ""}`}
        onClick={() => setModelOpen((prev) => !prev)}
        aria-expanded={modelOpen}
        aria-label={modelLocked ? t["composer.model.locked"] : t["composer.model"]}
        disabled={disabled}
      >
        <span className="composer-picker-model">
          {t[`composer.model.${modelKey}`]}
        </span>
        {modelLocked ? <Lock size={12} /> : <ChevronDown size={14} />}
      </button>
      {modelOpen && (
        <div className="composer-picker-menu composer-model-menu">
          {(
            [
              ["gpt-6-luna", t["composer.model.luna"]],
              ["deepseek-v4-flash", t["composer.model.ds"]],
              ["qwen3.8-flash", t["composer.model.qwen"]],
              ["glm-5.3-flash", t["composer.model.glm"]],
            ] as [SelectedModel, string][]
          ).map(([option, label]) => {
            const locked = peak && option === "deepseek-v4-flash";
            const active = model === option;
            return (
              <button
                key={option}
                type="button"
                className={`picker-model${locked ? " locked" : ""}${active ? " active" : ""}`}
                aria-label={locked ? t["composer.model.locked"] : undefined}
                disabled={locked || disabled}
                onClick={() => {
                  setModel(option);
                  setModelOpen(false);
                }}
              >
                <span className="picker-model-text">
                  <span className="picker-model-name">{label}</span>
                </span>
                {locked && <Lock size={12} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const attachmentLayer = (
    (images.length > 0 ||
      documents.length > 0 ||
      documentStatus.busy ||
      documentStatus.errors.length > 0) && (
      <div className="composer-attachments">
        <div className="composer-attachment-items">
          <div className="preview-grid">
            {images.map((image, index) => (
              <div key={index} className="preview">
                <img src={`data:${image.mimeType};base64,${image.data}`} alt={t["composer.previewAlt"]} />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  aria-label={t["composer.removeImage"]}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          {documents.length > 0 && (
            <div className="document-chip-grid" aria-label={t["composer.documents"]}>
              {documents.map((document) => (
                <div className="document-chip" key={document.id}>
                  {(() => {
                    const { Icon, label, tone } = documentInfo(document);
                    return (
                      <Icon
                        className={`document-chip-icon document-chip-icon-${tone}`}
                        size={26}
                        strokeWidth={1.8}
                        aria-hidden="true"
                      />
                    );
                  })()}
                  <span className="document-chip-body">
                    <span className="document-chip-name" title={document.name}>
                      {document.name}
                    </span>
                    <span className="document-chip-format">
                      {documentInfo(document).label}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDocuments((current) =>
                        current.filter((item) => item.id !== document.id)
                      )
                    }
                    aria-label={`${t["composer.removeDocument"]}: ${document.name}`}
                    disabled={disabled || documentBusy}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {documentStatus.busy && (
            <>
              {documentStatus.uploadNames.length > 0 ? (
                documentStatus.uploadNames.map((name, index) => (
                  <div className="document-upload-card" key={`${name}-${index}`} aria-live="polite">
                    <LoaderCircle size={22} className="spin document-upload-icon" aria-hidden="true" />
                    <span className="document-upload-body">
                      <strong title={name}>{name}</strong>
                      <span>
                        {documentStatus.phase === "processing"
                          ? t["composer.processingDocument"]
                          : t["composer.uploadingDocuments"].replace("{count}", "1")}
                      </span>
                    </span>
                  </div>
                ))
              ) : (
                <div className="document-upload-card" aria-live="polite">
                  <LoaderCircle size={22} className="spin document-upload-icon" aria-hidden="true" />
                  <span className="document-upload-body">
                    <strong>{t["composer.processingDocuments"]}</strong>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        {documentStatus.errors.length > 0 && (
          <div className="document-errors" role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            <ul>
              {documentStatus.errors.map((message, index) => (
                <li key={`${message}-${index}`}>{message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  );

  const voiceTimer =
    voiceStatus !== "idle" ? (
      <span
        className={`composer-mic-timer${voiceStatus === "transcribing" ? " dim" : ""}`}
        aria-live="polite"
      >
        {formatElapsed(elapsedMs)}
      </span>
    ) : null;

  const micButton = (
    <button
      type="button"
      className={`icon-button composer-mic${voiceStatus === "recording" ? " recording" : ""}${voiceStatus === "transcribing" ? " transcribing" : ""}`}
      onClick={handleMic}
      aria-label={micLabel}
      aria-pressed={voiceStatus === "recording"}
      aria-busy={voiceStatus === "transcribing"}
      disabled={disabled || voiceStatus === "transcribing"}
    >
      <Mic size={18} />
    </button>
  );

  const sendButton = sending ? (
    <button
      type="button"
      className="send-button"
      onClick={onStop}
      disabled={stopping}
      aria-busy={stopping}
      aria-label={t["composer.stop"]}
    >
      <Square size={15} fill="currentColor" />
    </button>
  ) : (
    <button
      type="button"
      className={`send-button${voiceStatus === "recording" ? " finish" : ""}`}
      onClick={handleSend}
      disabled={!canSend && !voiceBusy}
      aria-busy={shouldShowSendBusy}
      aria-label={voiceStatus === "recording" ? t["composer.finishAndSend"] : t["composer.send"]}
    >
      <ArrowUp size={18} />
    </button>
  );

  const documentPicker = (
    <DocumentPicker
      documents={documents}
      imageCount={images.length}
      imageNames={images.map((image) => image.name ?? "")}
      onChange={setDocuments}
      onBusyChange={setDocumentBusy}
      onImagesSelected={handleImageFiles}
      onValidationError={showAttachmentError}
      onStatusChange={handleDocumentStatus}
      disabled={disabled}
      renderTrigger={(open, triggerDisabled) => (
        <button
          type="button"
          className="icon-button"
          onClick={open}
          aria-label={t["composer.attachFile"]}
          disabled={triggerDisabled}
        >
          <Plus size={18} />
        </button>
      )}
    />
  );

  return (
    <div className="composer">
      {!isPhone || signedIn ? (
        <div className="composer-toolbar">
          {!isPhone && modeToggle}
          {signedIn && changes && (changes.additions > 0 || changes.deletions > 0) ? (
            <div
              className="composer-changes-pill"
              title={`${t["composer.changes"]}: +${changes.additions} −${changes.deletions}`}
              aria-label={`${t["composer.changes"]}: +${changes.additions} −${changes.deletions}`}
            >
              <span>{t["composer.changes"]}</span>
              <span className="composer-changes-add">+{changes.additions}</span>
              <span className="composer-changes-del">−{changes.deletions}</span>
            </div>
          ) : null}
          {signedIn ? (
            <button
              type="button"
              className="composer-git-button"
              onClick={sendCommitPush}
              disabled={disabled || sending}
              aria-label={t["git.button"]}
            >
              <span>{t["git.button"]}</span>
              <ArrowUp size={15} className="composer-git-icon" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
      {attachmentLayer}
      <div
        className={`input-row mode-${effectiveMode}${composerExpanded ? " composer-expanded" : ""}`}
      >
        {!useFooter && documentPicker}
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
           placeholder={placeholder ?? t["composer.placeholder"]}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
           aria-label={t["composer.message"]}
        />
        {!isPhone && !useFooter && modelPicker}
        {!useFooter && voiceTimer}
        {!useFooter && micButton}
        {!useFooter && sendButton}
        {useFooter && (
          <div className="composer-input-footer">
            {documentPicker}
            {modelPicker}
            <span className="composer-input-spacer" />
            {voiceTimer}
            {micButton}
            {sendButton}
          </div>
        )}
      </div>
      {isPhone && (
        <div className="composer-model-row">
          {modelPicker}
          {modeToggle}
        </div>
      )}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}