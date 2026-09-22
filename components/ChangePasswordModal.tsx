"use client";

import { useState } from "react";
import { STR, useUiLang } from "@/lib/i18n";

interface ChangePasswordResponse {
  errorCode?: string;
  min?: number;
  max?: number;
}

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const lang = useUiLang();
  const t = STR[lang];
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const body = (await response.json().catch(() => ({}))) as ChangePasswordResponse;
      if (!response.ok) {
        const message =
          body.errorCode === "currentPasswordRequired"
            ? t["settings.currentPasswordRequired"]
            : body.errorCode === "passwordRequired"
              ? t["settings.passwordRequired"]
              : body.errorCode === "passwordLength"
                ? t["auth.passwordLength"]
                    .replace("{min}", String(body.min ?? 8))
                    .replace("{max}", String(body.max ?? 128))
                : body.errorCode === "passwordMismatch"
                  ? t["settings.passwordMismatch"]
                  : body.errorCode === "invalidCurrentPassword"
                    ? t["settings.invalidCurrentPassword"]
                    : t["settings.changePasswordFailed"];
        throw new Error(message);
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t["settings.changePasswordFailed"]
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="auth-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="auth-modal change-password-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="auth-card">
          <div className="auth-card-head">
            <h2 id="change-password-title">{t["settings.changePassword"]}</h2>
          </div>
          <form onSubmit={submit} className="auth-form">
            <input
              className="auth-input"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder={t["settings.currentPassword"]}
              autoComplete="current-password"
              aria-label={t["settings.currentPassword"]}
              required
            />
            <input
              className="auth-input"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={t["settings.newPassword"]}
              autoComplete="new-password"
              aria-label={t["settings.newPassword"]}
              required
            />
            <input
              className="auth-input"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={t["settings.confirmPassword"]}
              autoComplete="new-password"
              aria-label={t["settings.confirmPassword"]}
              required
            />
            {error && <p className="conclusion-error">{error}</p>}
            <div className="change-password-actions">
              <button type="button" className="auth-toggle" onClick={onClose}>
                {t["actions.cancel"]}
              </button>
              <button type="submit" className="auth-button" disabled={busy}>
                {busy ? t["auth.pleaseWait"] : t["settings.changePasswordSave"]}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
