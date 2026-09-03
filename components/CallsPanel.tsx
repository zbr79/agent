"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiCall } from "@/lib/types";
import { modelLabel } from "@/lib/modelLabels";
import { STR, useUiLang } from "@/lib/i18n";

interface CallsData {
  calls: ApiCall[];
  total: number;
  failed: number;
}

export default function CallsPanel() {
  const lang = useUiLang();
  const t = STR[lang];
  const [data, setData] = useState<CallsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/calls");
      const body = await response.json();
      if (!response.ok) throw new Error(t["common.requestFailed"]);
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t["common.requestFailed"]);
    }
  }, [lang]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="usage-page">
      <h2>{t["calls.title"]}</h2>
      <p className="usage-sub">{t["calls.sub"]}</p>

      {error && <p className="conclusion-error">{error}</p>}

      {data && (
        <section className="usage-card">
          <div className="usage-head">
            <span className="usage-title">{t["calls.logged"]}</span>
            <span className="usage-big">{data.total}</span>
          </div>
          <div className="usage-meta">
            <span>{data.failed} {t["calls.failed"]}</span>
            <span>{data.total - data.failed} {t["calls.succeeded"]}</span>
          </div>
        </section>
      )}

      {data === null && !error && <p className="usage-sub">{t["calls.loading"]}</p>}

      {data !== null && data.calls.length === 0 && (
        <section className="usage-card">
          <span className="usage-title">
             {t["calls.empty"]}
          </span>
        </section>
      )}

      <div className="calls-list">
        {data?.calls.map((call) => (
          <div key={call._id} className={`call-row${call.ok ? "" : " failed"}`}>
            <div className="call-main">
                <span className="call-kind">{t[`calls.kind.${call.kind}`]}</span>
                <span className="call-model">{modelLabel(call.model)}</span>
                <span className="call-status">
                  {call.ok ? t["calls.statusOk"] : t["calls.statusError"]}
                </span>
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
    </div>
  );
}
