"use client";

import { Paperclip } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { STR, useUiLang } from "@/lib/i18n";
import { DOCUMENT_EXTENSIONS } from "@/lib/documents/limits";
import type { DocumentAttachment } from "@/lib/documents/types";
import { uploadDocuments } from "@/lib/documentUpload";
import { MAX_ATTACHMENTS, normalizeAttachmentName } from "@/lib/attachments/limits";

interface DocumentPickerProps {
  documents: DocumentAttachment[];
  imageCount: number;
  imageNames: string[];
  onChange: (documents: DocumentAttachment[]) => void;
  onBusyChange: (busy: boolean) => void;
  onImagesSelected?: (files: File[]) => Promise<number> | number | void;
  onValidationError?: (message: string) => void;
  onStatusChange?: (status: DocumentPickerStatus) => void;
  renderTrigger?: (open: () => void, disabled: boolean) => ReactNode;
  disabled?: boolean;
}

export interface DocumentPickerStatus {
  busy: boolean;
  progress: number;
  phase: "uploading" | "processing" | null;
  uploadNames: string[];
  errors: string[];
}

export default function DocumentPicker({
  documents,
  imageCount,
  imageNames,
  onChange,
  onBusyChange,
  onImagesSelected,
  onValidationError,
  onStatusChange,
  renderTrigger,
  disabled = false,
}: DocumentPickerProps) {
  const lang = useUiLang();
  const t = STR[lang];
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"uploading" | "processing" | null>(null);
  const [uploadNames, setUploadNames] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const triggerDisabled = disabled || busy;

  useEffect(() => {
    onStatusChange?.({ busy, progress, phase, uploadNames, errors });
  }, [busy, progress, phase, uploadNames, errors, onStatusChange]);

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const isImage = (file: File) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      /\.(jpe?g|png|webp)$/i.test(file.name);
    const isDocument = (file: File) =>
      DOCUMENT_EXTENSIONS.has(file.name.slice(file.name.lastIndexOf(".")).toLowerCase());
    const candidates = files.filter((file) => isImage(file) || isDocument(file));
    const rejected = files
      .filter((file) => !candidates.includes(file))
      .map((file) => `${file.name}: ${t["composer.unsupportedAttachment"]}`);
    const names = new Set(
      [...imageNames, ...documents.map((document) => document.name)]
        .map(normalizeAttachmentName)
        .filter(Boolean)
    );
    const accepted: File[] = [];
    let duplicateFound = false;
    for (const file of candidates) {
      const normalizedName = normalizeAttachmentName(file.name);
      if (names.has(normalizedName)) {
        duplicateFound = true;
        continue;
      }
      names.add(normalizedName);
      accepted.push(file);
    }
    if (duplicateFound) {
      onValidationError?.(t["composer.duplicateAttachment"]);
    }
    const room = MAX_ATTACHMENTS - imageCount - documents.length;
    if (room <= 0) {
      onValidationError?.(t["composer.maxAttachmentsReached"]);
      return;
    }
    if (accepted.length > room) {
      onValidationError?.(t["composer.maxAttachments"]);
    }
    const selected = accepted.slice(0, room);
    const imageFiles = selected.filter(isImage);
    const documentFiles = selected.filter(isDocument);
    setErrors(rejected);
    const loadedImageCount =
      imageFiles.length > 0 ? (await onImagesSelected?.(imageFiles)) ?? imageFiles.length : 0;
    if (documentFiles.length === 0) return;
    setBusy(true);
    onBusyChange(true);
    setProgress(0);
    setPhase("uploading");
    setUploadNames(documentFiles.map((file) => file.name));
    setErrors(rejected);
    try {
      const result = await uploadDocuments(
        documentFiles,
        (value) => setProgress(value),
        () => setPhase("processing")
      );
      const documentRoom = Math.max(0, MAX_ATTACHMENTS - imageCount - loadedImageCount);
      onChange([...documents, ...result.documents].slice(0, documentRoom));
      if (result.errors.length > 0) setErrors([...rejected, ...result.errors]);
    } catch (uploadError) {
      setErrors([
        uploadError instanceof Error ? uploadError.message : t["composer.documentError"],
      ]);
    } finally {
      setBusy(false);
      onBusyChange(false);
      setPhase(null);
      setUploadNames([]);
    }
  };

  const openPicker = () => {
    if (disabled || busy) return;
    if (imageCount + documents.length >= MAX_ATTACHMENTS) {
      onValidationError?.(t["composer.maxAttachmentsReached"]);
      return;
    }
    fileRef.current?.click();
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.pdf,.docx,.xlsx,.txt,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        multiple
        hidden
        onChange={handleFiles}
      />
      {renderTrigger ? (
        renderTrigger(openPicker, triggerDisabled)
      ) : (
        <button
          type="button"
          className="icon-button"
          onClick={openPicker}
          aria-label={t["composer.attachFile"]}
          title={t["composer.attachFile"]}
          disabled={triggerDisabled}
        >
          <Paperclip size={17} />
        </button>
      )}
    </>
  );
}
