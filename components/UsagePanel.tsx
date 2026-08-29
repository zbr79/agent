"use client";

import { useEffect, useState } from "react";
import { STR, useUiLang } from "@/lib/i18n";

interface UsageModel {
  name: string;
  label: string;
  tier: string;
  vision: string;
  retired: boolean;
  used: number;
  exhaustedAt: number | null;
}

interface UsageData {
  model: string;
  day: { used: number; limit: number; resetAt: string };
  minute: { used: number; limit: number };
  errors: number;
  models: UsageModel[];
}

function percent(used: number, limit: number): number {
  return Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
}

export default function UsagePanel() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const lang = useUiLang();
  const t = STR[lang];

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/usage")
        .then((response) => response.json())
        .then((data: UsageData) => {
          if (alive) setUsage(data);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const day = usage?.day ?? { used: 0, limit: 20, resetAt: "" };
  const minute = usage?.minute ?? { used: 0, limit: 10 };
  const dayPct = percent(day.used, day.limit);
  const minutePct = percent(minute.used, minute.limit);
  const resetLabel = day.resetAt
    ? new Date(day.resetAt).toLocaleString([], {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Los_Angeles",
      })
    : "—";

  return (
    <div className="usage-page">
      <h2>{t["usage.title"]}</h2>
      <p className="usage-sub">
        {t["usage.sub"]}
        {usage ? ` (${usage.model})` : ""}.
      </p>

      <section className="usage-card">
        <div className="usage-head">
          <span className="usage-title">{t["usage.requestsToday"]}</span>
          <span className="usage-big">
            {day.used.toLocaleString()}{" "}
            <span className="usage-dim">/ {day.limit.toLocaleString()}</span>
          </span>
        </div>
        <div className="usage-track large">
          <div
            className={`usage-fill ${dayPct >= 90 ? "warn" : ""}`}
            style={{ width: `${dayPct}%` }}
          />
        </div>
        <div className="usage-meta">
          <span>{dayPct}% {t["usage.usedPct"]}</span>
          <span>{t["usage.resets"]} {resetLabel} PT</span>
        </div>
      </section>

      <section className="usage-card">
        <div className="usage-head">
          <span className="usage-title">{t["usage.requestsMinute"]}</span>
          <span className="usage-big">
            {minute.used} <span className="usage-dim">/ {minute.limit}</span>
          </span>
        </div>
        <div className="usage-track large">
          <div
            className={`usage-fill ${minutePct >= 90 ? "warn" : ""}`}
            style={{ width: `${minutePct}%` }}
          />
        </div>
        <div className="usage-meta">
          <span>{minutePct}% {t["usage.usedPct"]}</span>
        </div>
      </section>

      {usage && usage.errors > 0 && (
        <section className="usage-card warn-card">
          <span className="usage-title">{t["usage.failed"]}</span>
          <span className="usage-big">{usage.errors}</span>
        </section>
      )}

      <section className="usage-card">
        <span className="usage-title">{t["usage.catalog"]}</span>
        <p className="usage-sub">{t["usage.catalogNote"]}</p>
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
              {usage.models.map((model) => (
                <tr key={model.name} className={model.retired ? "retired" : ""}>
                  <td className="model-name">
                    {model.label}
                    <span className="model-name-raw">{model.name}</span>
                  </td>
                  <td className="model-used">{model.used}</td>
                  <td className="model-status">
                    {model.retired ? (
                      <span className="status-badge retired">{t["usage.retired"]}</span>
                    ) : model.exhaustedAt ? (
                      <span className="status-badge quota">{t["usage.ranOut"]}</span>
                    ) : model.used > 0 ? (
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

      <section className="usage-card note">
        <span className="usage-title">{t["usage.aboutTitle"]}</span>
        <ul>
          <li>Free tier: ~20 requests/day per model, ~10 requests/min — confirmed by the API&apos;s quota error for {usage?.model ?? "the current model"}.</li>
          <li>Daily cap resets at midnight Pacific Time.</li>
          <li>Google has no public quota API, so this tracks this app&apos;s own calls.</li>
          <li>Occasional &quot;high demand&quot; errors are capacity, not quota — the app retries automatically.</li>
        </ul>
      </section>
    </div>
  );
}
