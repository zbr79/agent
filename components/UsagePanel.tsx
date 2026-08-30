"use client";

import { useCallback, useEffect, useState } from "react";
import { STR, useUiLang } from "@/lib/i18n";

interface UsageModel {
  name: string;
  label: string;
  tier: string;
  vision: boolean;
  retired: boolean;
  used: number;
}

interface UsageWindow {
  status: string;
  percent: number;
  resetsAt: string;
}

interface UsageData {
  model: string;
  official: {
    rolling: UsageWindow;
    weekly: UsageWindow;
    monthly: UsageWindow;
  } | null;
  models: UsageModel[];
}

function relativeResets(at: string): string {
  const ms = Date.parse(at) - Date.now();
  if (ms <= 0) return "0 minutes";
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    const restHours = hours % 24;
    return `${days} day${days === 1 ? "" : "s"} ${restHours} hour${restHours === 1 ? "" : "s"}`;
  }
  if (hours > 0) {
    const restMins = mins % 60;
    return `${hours} hour${hours === 1 ? "" : "s"} ${restMins} minute${restMins === 1 ? "" : "s"}`;
  }
  if (mins > 0) return `${mins} minute${mins === 1 ? "" : "s"}`;
  return "0 minutes";
}

export default function UsagePanel() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lang = useUiLang();
  const t = STR[lang];

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/usage");
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Could not load usage.");
      setUsage(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load usage.");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="usage-page">
      <h2>{t["usage.title"]}</h2>

      {error && <p className="conclusion-error">{error}</p>}

      <section className="usage-card">
        {t["opencodeCalls.official"] && (
          <span className="usage-title">{t["opencodeCalls.official"]}</span>
        )}
        {t["opencodeCalls.officialSub"] && (
          <p className="usage-sub">{t["opencodeCalls.officialSub"]}</p>
        )}
        {usage?.official ? (
          (["rolling", "weekly", "monthly"] as const).map((win) => {
            const w = usage.official![win];
            return (
              <div key={win} style={{ marginTop: 14 }}>
                <div className="usage-head">
                  <span className="usage-title">{t[`opencodeCalls.${win}`]}</span>
                  <span className="usage-big">{w.percent}%</span>
                </div>
                <div className="usage-track large">
                  <div
                    className={`usage-fill ${w.percent >= 90 ? "warn" : ""}`}
                    style={{ width: `${Math.min(100, Math.max(0, w.percent))}%` }}
                  />
                </div>
                <div className="usage-meta">
                  <span>
                    {t["opencodeCalls.resets"]} {relativeResets(w.resetsAt)}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <p className="usage-sub">{t["opencodeCalls.officialUnavailable"]}</p>
        )}
      </section>

      <section className="usage-card">
        {usage && (
          <table className="usage-models">
            <thead>
              <tr>
                <th>{t["usage.colModel"]}</th>
                <th>{t["usage.colSent"]}</th>
                <th>{t["usage.colStatus"]}</th>
              </tr>
            </thead>
            <tbody>
              {usage.models
                .filter((model) => !model.retired && model.used > 0)
                .map((model) => (
                  <tr key={model.name}>
                    <td className="model-name">{model.label}</td>
                    <td className="model-used">{model.used}</td>
                    <td className="model-status">
                      {model.used > 0 ? (
                        <span className="status-badge used">{t["usage.inUse"]}</span>
                      ) : (
                        <span className="status-badge ok">{t["usage.available"]}</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
