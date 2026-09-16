"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  GitCommitHorizontal,
  Lock,
  Mic,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { ChatImage, WorkspaceId } from "@/lib/types";
import { GUEST_MAX_AUDIO_MS, MAX_AUDIO_BYTES, MAX_IMAGES, USER_MAX_AUDIO_MS } from "@/lib/types";
import { STR, useUiLang } from "@/lib/i18n";
import {
  useChatMode,
  useCompressImages,
  useDeepSeekPeak,
  useReasoningEffort,
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

const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface ComposerProps {
  sending: boolean;
  onSend: (text: string, images?: ChatImage[]) => void;
  onStop: () => void;
  disabled?: boolean;
  placeholder?: string;
  signedIn?: boolean;
  onRequireAuth?: () => void;
  workspaceId?: WorkspaceId;
}

interface GitFile {
  path: string;
  status: string;
  safe: boolean;
}

interface GitStatus {
  branch: string;
  upstream: string | null;
  files: GitFile[];
  clean: boolean;
  skipped: string[];
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

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function Composer({
  sending,
  onSend,
  onStop,
  disabled = false,
  placeholder,
  signedIn = false,
  onRequireAuth,
  workspaceId = "agent",
}: ComposerProps) {
  const lang = useUiLang();
  const t = STR[lang];
  const [compressOn] = useCompressImages();
  const [reasoning, setReasoning] = useReasoningEffort();
  const [model, setModel] = useSelectedModel();
  const peak = useDeepSeekPeak();
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [mode, setMode] = useChatMode();
  const [text, setText] = useState("");
  const [images, setImages] = useState<ChatImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "recording" | "transcribing">("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [gitOpen, setGitOpen] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitMessage, setGitMessage] = useState("");
  const [gitHint, setGitHint] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceRef = useRef<VoiceRecordHandle | null>(null);
  const autoSendRef = useRef(false);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const pickerRef = useRef<HTMLDivElement>(null);
  const effortRef = useRef<HTMLDivElement>(null);
  const textRef = useRef(text);
  textRef.current = text;

  // Close the pickers on outside click / Escape.
  useEffect(() => {
    if (!modelOpen && !effortOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (pickerRef.current && !pickerRef.current.contains(target)) setModelOpen(false);
      if (effortRef.current && !effortRef.current.contains(target)) setEffortOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModelOpen(false);
        setEffortOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [modelOpen, effortOpen]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    return () => {
      voiceRef.current?.cancel();
    };
  }, []);

  const modelLocked = peak && model === "deepseek-v4-flash";
  const modelKey =
    model === "qwen3.8-flash" ? "qwen" : model === "glm-5.3-flash" ? "glm" : "ds";
  const effectiveMode: ChatMode = signedIn ? mode : "plan";
  const canSend = (text.trim().length > 0 || images.length > 0) && !sending && !disabled;
  // During the voice flow the send button stays live: pressing it queues an
  // auto-send once the transcript lands.
  const voiceBusy = voiceStatus !== "idle" && !sending && !disabled;
  const shouldShowSendBusy = voiceStatus === "transcribing" && !sending && !disabled;
  const hint = voiceHint || imageError;

  const fetchGitMessage = async () => {
    setGitBusy(true);
    setGitHint(null);
    try {
      const statusResponse = await fetch(
        `/api/git/status?workspaceId=${encodeURIComponent(workspaceId)}`,
        { credentials: "same-origin" }
      );
      const statusBody = (await statusResponse.json().catch(() => null)) as
        | (GitStatus & { error?: string })
        | null;
      if (!statusResponse.ok) throw new Error(statusBody?.error || t["git.error"]);
      if (!statusBody || statusBody.clean) {
        setGitOpen(false);
        setGitHint(t["git.empty"]);
        return;
      }
      setGitStatus(statusBody);
      const messageResponse = await fetch("/api/git/message", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const messageBody = (await messageResponse.json().catch(() => null)) as
        | { message?: string; error?: string; skipped?: string[] }
        | null;
      if (!messageResponse.ok || !messageBody?.message) {
        throw new Error(messageBody?.error || t["git.generateFailed"]);
      }
      setGitMessage(messageBody.message);
      setGitOpen(true);
    } catch (error) {
      setGitHint(error instanceof Error ? error.message : t["git.error"]);
    } finally {
      setGitBusy(false);
    }
  };

  const commitGit = async (push: boolean) => {
    if (!gitMessage.trim()) {
      setGitHint(t["git.messageRequired"]);
      return;
    }
    setGitBusy(true);
    setGitHint(null);
    try {
      const response = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message: gitMessage, push, workspaceId }),
      });
      const body = (await response.json().catch(() => null)) as
        | { sha?: string; pushed?: boolean; error?: string }
        | null;
      if (!response.ok) throw new Error(body?.error || t["git.commitFailed"]);
      setGitOpen(false);
      setGitStatus(null);
      setGitMessage("");
      setGitHint(
        body?.pushed
          ? t["git.pushed"].replace("{sha}", body.sha || "")
          : t["git.committed"].replace("{sha}", body?.sha || "")
      );
    } catch (error) {
      setGitHint(error instanceof Error ? error.message : t["git.commitFailed"]);
    } finally {
      setGitBusy(false);
    }
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
    onSend(text.trim(), images.length > 0 ? images : undefined);
    setText("");
    setImages([]);
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
      if (compressOn) {
        for (let i = 0; i < loaded.length; i++) {
          try {
            loaded[i] = await compressImage(loaded[i]);
          } catch {}
        }
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
          onSend(trimmed, imgs.length > 0 ? imgs : undefined);
          setText("");
          setImages([]);
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

  return (
    <div className="composer">
      {signedIn && gitOpen && gitStatus ? (
        <section className="git-sheet" aria-live="polite">
          <div className="git-sheet-header">
            <div>
              <strong>{t["git.title"]}</strong>
              <span>{gitStatus.branch}</span>
            </div>
            <button
              type="button"
              className="git-sheet-close"
              onClick={() => setGitOpen(false)}
              disabled={gitBusy}
              aria-label={t["actions.cancel"]}
            >
              <X size={16} />
            </button>
          </div>
          <div className="git-file-list">
            {gitStatus.files.map((file) => (
              <div className={`git-file${file.safe ? "" : " skipped"}`} key={`${file.status}:${file.path}`}>
                <code>{file.status}</code>
                <span>{file.path}</span>
                {!file.safe ? <em>{t["git.skipped"]}</em> : null}
              </div>
            ))}
          </div>
          <label className="git-message-label" htmlFor="git-commit-message">
            {t["git.message"]}
          </label>
          <textarea
            id="git-commit-message"
            className="git-message-input"
            value={gitMessage}
            maxLength={500}
            disabled={gitBusy}
            onChange={(event) => setGitMessage(event.target.value)}
          />
          <div className="git-sheet-actions">
            <button
              type="button"
              className="git-secondary-button"
              onClick={() => void fetchGitMessage()}
              disabled={gitBusy}
            >
              <RefreshCw size={14} className={gitBusy ? "spin" : ""} />
              {t["git.regenerate"]}
            </button>
            <button
              type="button"
              className="git-secondary-button"
              onClick={() => void commitGit(false)}
              disabled={gitBusy}
            >
              {t["git.commit"]}
            </button>
            <button
              type="button"
              className="git-primary-button"
              onClick={() => void commitGit(true)}
              disabled={gitBusy}
            >
              <GitCommitHorizontal size={14} />
              {t["git.commitPush"]}
            </button>
          </div>
        </section>
      ) : null}
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
      <div className="composer-toolbar">
        <div className="composer-picker" ref={pickerRef}>
          <button
            type="button"
            className={`composer-reasoning composer-model-pill${modelOpen ? " open" : ""}${modelLocked ? " locked" : ""}`}
            onClick={() => {
              setModelOpen((prev) => !prev);
              setEffortOpen(false);
            }}
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
        <div className="composer-picker" ref={effortRef}>
          <button
            type="button"
            className={`composer-reasoning composer-effort-pill${effortOpen ? " open" : ""}`}
            onClick={() => {
              setEffortOpen((prev) => !prev);
              setModelOpen(false);
            }}
            aria-expanded={effortOpen}
            aria-label={t["composer.effort"]}
            disabled={disabled}
          >
            <span className="composer-picker-effort">
              {reasoning === "max" ? t["composer.effort.max"] : t["composer.effort.balance"]}
            </span>
            <ChevronDown size={14} />
          </button>
          {effortOpen && (
            <div className="composer-picker-menu composer-effort-menu">
              {(["balance", "max"] as const).map((effort) => (
                <button
                  key={effort}
                  type="button"
                  className={`picker-model${reasoning === effort ? " active" : ""}`}
                  disabled={disabled}
                  onClick={() => {
                    setReasoning(effort);
                    setEffortOpen(false);
                  }}
                >
                  <span className="picker-model-text">
                    <span className="picker-model-name">
                      {effort === "max"
                        ? t["composer.effort.max"]
                        : t["composer.effort.balance"]}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          className="composer-mode"
          role="group"
          aria-label={t["composer.mode"]}
        >
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
        {signedIn ? (
          <button
            type="button"
            className="composer-git-button"
            onClick={() => void fetchGitMessage()}
            disabled={disabled || sending || gitBusy}
            aria-label={t["git.button"]}
          >
            {gitBusy ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
            <span>{t["git.button"]}</span>
          </button>
        ) : null}
      </div>
      <div className={`input-row mode-${effectiveMode}`}>
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
          disabled={images.length >= MAX_IMAGES || disabled}
        >
          <Plus size={18} />
        </button>
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
        {voiceStatus !== "idle" && (
          <span
            className={`composer-mic-timer${voiceStatus === "transcribing" ? " dim" : ""}`}
            aria-live="polite"
          >
            {formatElapsed(elapsedMs)}
          </span>
        )}
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
        {sending ? (
           <button type="button" className="send-button" onClick={onStop} aria-label={t["composer.stop"]}>
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
        )}
      </div>
      {(hint || gitHint) && <p className="hint">{hint || gitHint}</p>}
    </div>
  );
}