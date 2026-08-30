"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiCall } from "@/lib/types";
import { modelLabel } from "@/lib/modelLabels";

interface CallsData {
  calls: ApiCall[];
  total: number;
  failed: number;
}

export default function CallsPanel() {
  const [data, setData] = useState<CallsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/calls");
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Could not load calls.");
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load calls.");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="usage-page">
      <h2>API Calls</h2>
      <p className="usage-sub">
        Every API call this app makes, logged in MongoDB — our own record of
        what the models did. Newest first.
      </p>

      {error && <p className="conclusion-error">{error}</p>}

      {data && (
        <section className="usage-card">
          <div className="usage-head">
            <span className="usage-title">Calls logged</span>
            <span className="usage-big">{data.total}</span>
          </div>
          <div className="usage-meta">
            <span>{data.failed} failed</span>
            <span>{data.total - data.failed} succeeded</span>
          </div>
        </section>
      )}

      {data === null && !error && <p className="usage-sub">Loading…</p>}

      {data !== null && data.calls.length === 0 && (
        <section className="usage-card">
          <span className="usage-title">
            No calls yet — send a chat message or run a Conclude.
          </span>
        </section>
      )}

      <div className="calls-list">
        {data?.calls.map((call) => (
          <div key={call._id} className={`call-row${call.ok ? "" : " failed"}`}>
            <div className="call-main">
              <span className="call-kind">{call.kind}</span>
              <span className="call-model">{modelLabel(call.model)}</span>
              <span className="call-status">{call.ok ? "ok" : "error"}</span>
            </div>
            <span className="call-time">
              {new Date(call.at).toLocaleString([], {
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
