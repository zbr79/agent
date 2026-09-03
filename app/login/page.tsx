"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STR, setUiLang, useUiLang } from "@/lib/i18n";

interface AuthResponse {
  error?: string;
  errorCode?: string;
  min?: number;
  max?: number;
}

export default function LoginPage() {
  const router = useRouter();
  const lang = useUiLang();
  const t = STR[lang];
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, language: lang }),
      });
      const body = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok) {
        const message =
          body.errorCode === "invalidCredentials"
            ? t["auth.invalidCredentials"]
            : body.errorCode === "usernameTaken"
              ? t["auth.usernameTaken"]
              : body.errorCode === "usernameInvalid"
                ? t["auth.usernameInvalid"]
                : body.errorCode === "passwordLength"
                  ? t["auth.passwordLength"]
                      .replace("{min}", String(body.min ?? 8))
                      .replace("{max}", String(body.max ?? 128))
                  : body.errorCode === "usernameRequired"
                    ? t["auth.usernameRequired"]
                    : body.errorCode === "passwordRequired"
                      ? t["auth.passwordRequired"]
                      : body.errorCode === "invalidBody"
                        ? t["auth.invalidBody"]
                        : mode === "login"
                          ? t["auth.signInFailed"]
                          : t["auth.createFailed"];
        throw new Error(message);
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t["auth.generic"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card-head">
          <h2>{mode === "login" ? t["auth.signIn"] : t["auth.createAccount"]}</h2>
          <button
            type="button"
            className="auth-lang-toggle"
            onClick={() => setUiLang(lang === "zh" ? "en" : "zh")}
            aria-label={t["settings.language"]}
          >
            {t["lang.button"]}
          </button>
        </div>
        <p className="usage-sub">
          {t["auth.description"]}
        </p>
        <form onSubmit={submit} className="auth-form">
          <input
            className="auth-input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t["auth.username"]}
            autoComplete="username"
            aria-label={t["auth.username"]}
            required
          />
          <input
            className="auth-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === "register" ? t["auth.passwordHint"] : t["auth.password"]}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            aria-label={t["auth.password"]}
            required
          />
          {error && <p className="conclusion-error">{error}</p>}
          <button type="submit" className="auth-button" disabled={busy}>
            {busy
              ? t["auth.pleaseWait"]
              : mode === "login"
                ? t["auth.signIn"]
                : t["auth.createAccount"]}
          </button>
        </form>
        <button
          type="button"
          className="auth-toggle"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login"
            ? t["auth.noAccount"]
            : t["auth.haveAccount"]}
        </button>
      </div>
    </div>
  );
}
