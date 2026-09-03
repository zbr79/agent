"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiCall } from "@/lib/types";
import { STR, useUiLang } from "@/lib/i18n";
import { modelLabel } from "@/lib/modelLabels";

interface OpenCodeUsageWindow {
  status: string;
  percent: number;
  resetsAt: string;
}

interface OpenCodeUsageData {
  total: number;
  last5h: number;
  last7d: number;
  last30d: number;
  failed30d: number;
  cost30d: number;
  tokens30d: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
  models: { model: string; count: number }[];
  recent: ApiCall[];
  official: {
    rolling: OpenCodeUsageWindow;
    weekly: OpenCodeUsageWindow;
    monthly: OpenCodeUsageWindow;
  } | null;
}

// Request-cap estimates for deepseek-v4-pro from the OpenCode Go docs
// (limits are dollar-based; these are the published request equivalents).
const LIMITS = {
  h5: 1050,
  w7: 2600,
  m30: 5200,
};

function percent(used: number, limit: number): number {
  return Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
}

export default function OpenCodeCallsPanel() {
  const [data, setData] = useState<OpenCodeUsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lang = useUiLang();
  const t = STR[lang];

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/opencode-calls");
      const body = await response.json();
      if (!response.ok) {
        throw new Error(t["common.requestFailed"]);
      }
      setData(body);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t["common.requestFailed"]
      );
    }
  }, [lang]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5_000);
    return () => clearInterval(timer);
  }, [load]);

  const h5 = data?.last5h ?? 0;
  const w7 = data?.last7d ?? 0;
  const m30 = data?.last30d ?? 0;
  const pct5 = percent(h5, LIMITS.h5);
  const pct7 = percent(w7, LIMITS.w7);
  const pct30 = percent(m30, LIMITS.m30);

  return (
    <div className="usage-page">
      <h2>{t["opencodeCalls.title"]}</h2>
      <p className="usage-sub">{t["opencodeCalls.sub"]}</p>

      {error && <p className="conclusion-error">{error}</p>}

      <section className="usage-card">
        <div className="usage-head">
          <span className="usage-title">{t["opencodeCalls.h5"]}</span>
          <span className="usage-big">
            {h5.toLocaleString()}{" "}
            <span className="usage-dim">/ {LIMITS.h5.toLocaleString()}</span>
          </span>
        </div>
        <div className="usage-track large">
          <div
            className={`usage-fill ${pct5 >= 90 ? "warn" : ""}`}
            style={{ width: `${pct5}%` }}
          />
        </div>
        <div className="usage-meta">
          <span>
            {pct5}% {t["usage.usedPct"]}
          </span>
        </div>
      </section>

      <section className="usage-card">
        <div className="usage-head">
          <span className="usage-title">{t["opencodeCalls.w7"]}</span>
          <span className="usage-big">
            {w7.toLocaleString()}{" "}
            <span className="usage-dim">/ {LIMITS.w7.toLocaleString()}</span>
          </span>
        </div>
        <div className="usage-track large">
          <div
            className={`usage-fill ${pct7 >= 90 ? "warn" : ""}`}
            style={{ width: `${pct7}%` }}
          />
        </div>
        <div className="usage-meta">
          <span>
            {pct7}% {t["usage.usedPct"]}
          </span>
        </div>
      </section>

      <section className="usage-card">
        <div className="usage-head">
          <span className="usage-title">{t["opencodeCalls.m30"]}</span>
          <span className="usage-big">
            {m30.toLocaleString()}{" "}
            <span className="usage-dim">/ {LIMITS.m30.toLocaleString()}</span>
          </span>
        </div>
        <div className="usage-track large">
          <div
            className={`usage-fill ${pct30 >= 90 ? "warn" : ""}`}
            style={{ width: `${pct30}%` }}
          />
        </div>
        <div className="usage-meta">
          <span>
            {pct30}% {t["usage.usedPct"]}
          </span>
        </div>
      </section>

      <section className="usage-card">
        <div className="usage-head">
          <span className="usage-title">{t["opencodeCalls.total"]}</span>
          <span className="usage-big">{(data?.total ?? 0).toLocaleString()}</span>
        </div>
        <div className="usage-meta">
          <span>{data?.failed30d ?? 0} {t["opencodeCalls.failed"]}</span>
          <span>
            {t["opencodeCalls.cost30d"]}: ${(data?.cost30d ?? 0).toFixed(4)}
          </span>
        </div>
        {data && data.tokens30d && (
          <div className="usage-meta">
            <span>
              {t["opencodeCalls.tokens30d"]}:{" "}
              {(data.tokens30d.input + data.tokens30d.output + data.tokens30d.reasoning).toLocaleString()}
            </span>
          </div>
        )}
      </section>

      <section className="usage-card">
        <span className="usage-title">{t["opencodeCalls.byModel"]}</span>
        {data && data.models.length > 0 ? (
          <table className="usage-models">
            <thead>
              <tr>
                <th>{t["usage.colModel"]}</th>
                <th>{t["usage.colSent"]}</th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((row) => (
                <tr key={row.model}>
                  <td className="model-name">
                    <span className="model-name-raw">{row.model}</span>
                  </td>
                  <td className="model-used">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="usage-sub">{t["opencodeCalls.empty"]}</p>
        )}
      </section>

      <section className="usage-card">
        <span className="usage-title">{t["opencodeCalls.recent"]}</span>
        {data !== null && data.recent.length === 0 && (
          <p className="usage-sub">{t["opencodeCalls.empty"]}</p>
        )}
        <div className="calls-list">
          {data?.recent.map((call) => (
            <div key={call._id} className={`call-row${call.ok ? "" : " failed"}`}>
              <div className="call-main">
                <span className="call-kind">{t["calls.kind.opencode"]}</span>
                <span className="call-model">{modelLabel(call.model)}</span>
                <span className="call-status">
                  {call.ok ? t["calls.statusOk"] : t["calls.statusError"]}
                </span>
                {typeof call.cost === "number" && (
                  <span className="call-cost">${call.cost.toFixed(4)}</span>
                )}
              </div>
              <span className="call-time">
                 {new Date(call.at).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              {call.error && <p className="call-error">{call.error}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="usage-card note">
        <span className="usage-title">{t["opencodeCalls.about"]}</span>
        <ul>
          <li>{t["opencodeCalls.about1"]}</li>
          <li>{t["opencodeCalls.about2"]}</li>
        </ul>
      </section>
    </div>
  );
}
