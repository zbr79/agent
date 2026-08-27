"use client";

import { useEffect, useState } from "react";

interface UsageData {
  model: string;
  day: { used: number; limit: number; resetAt: string };
  minute: { used: number; limit: number };
  errors: number;
}

function percent(used: number, limit: number): number {
  return Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
}

export default function UsagePanel() {
  const [usage, setUsage] = useState<UsageData | null>(null);

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

  const day = usage?.day ?? { used: 0, limit: 1500, resetAt: "" };
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
      <h2>API Usage</h2>
      <p className="usage-sub">
        Calls made by this app against the Gemini free tier
        {usage ? ` (${usage.model})` : ""}.
      </p>

      <section className="usage-card">
        <div className="usage-head">
          <span className="usage-title">Requests today</span>
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
          <span>{dayPct}% used</span>
          <span>resets {resetLabel} PT</span>
        </div>
      </section>

      <section className="usage-card">
        <div className="usage-head">
          <span className="usage-title">Requests in the last 60 seconds</span>
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
          <span>{minutePct}% used</span>
        </div>
      </section>

      {usage && usage.errors > 0 && (
        <section className="usage-card warn-card">
          <span className="usage-title">Failed calls today</span>
          <span className="usage-big">{usage.errors}</span>
        </section>
      )}

      <section className="usage-card note">
        <span className="usage-title">About these limits</span>
        <ul>
          <li>Free tier: ~1,500 requests/day, ~10 requests/min on Flash models.</li>
          <li>Daily cap resets at midnight Pacific Time.</li>
          <li>Google has no public quota API, so this tracks this app&apos;s own calls.</li>
          <li>Occasional &quot;high demand&quot; errors are capacity, not quota — the app retries automatically.</li>
        </ul>
      </section>
    </div>
  );
}
