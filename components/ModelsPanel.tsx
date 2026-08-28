"use client";

import { useCallback, useEffect, useState } from "react";

interface ModelRow {
  name: string;
  label: string;
  tier: "lite" | "pro" | "omni";
  vision: "yes" | "unverified";
  retired: boolean;
  used: number;
  exhaustedByApi: boolean;
}

interface ModelsData {
  current: string;
  concludeModel?: string;
  limit: number;
  models: ModelRow[];
}

interface HealthResult {
  model: string;
  status: "ok" | "quota" | "busy" | "retired" | "empty" | "error";
  ms: number;
  detail?: string;
}

interface HealthData {
  results: HealthResult[];
  cachedAt: number;
  stale?: boolean;
}

export default function ModelsPanel() {
  const [data, setData] = useState<ModelsData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [checking, setChecking] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/models");
      if (!response.ok) throw new Error("Could not load models.");
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load models.");
    }
  }, []);

  const loadHealth = useCallback(async (force: boolean) => {
    if (force) setChecking(true);
    try {
      const response = await fetch(force ? "/api/health?force=1" : "/api/health");
      if (!response.ok) throw new Error("Could not run health check.");
      const body = (await response.json()) as HealthData;
      setHealth(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run health check.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadHealth(false);
  }, [load, loadHealth]);

  const switchTo = async (name: string) => {
    if (!data || switching) return;
    setSwitching(name);
    setError(null);
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Switch failed.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Switch failed.");
    } finally {
      setSwitching(null);
    }
  };

  const models = data?.models ?? [];
  const limit = data?.limit ?? 20;
  const autoMode = data?.current === "auto";
  const healthByModel = new Map((health?.results ?? []).map((r) => [r.model, r]));
  const visible = models.filter(
    (model) => !model.retired && healthByModel.get(model.name)?.status !== "retired"
  );
  const visionConfirmed = visible.filter((model) => model.vision === "yes");
  const liteModels = visible.filter((model) => model.tier === "lite");

  const counts = { ok: 0, quota: 0, busy: 0, other: 0 };
  for (const model of visible) {
    const status = healthByModel.get(model.name)?.status ?? null;
    if (status === "ok") counts.ok += 1;
    else if (status === "quota") counts.quota += 1;
    else if (status === "busy") counts.busy += 1;
    else counts.other += 1;
  }

  const checkedLabel = health?.cachedAt
    ? new Date(health.cachedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <div className="usage-page">
      <h2>Models</h2>
      <p className="usage-sub">
        <strong>Auto</strong> (default): chat tries the best model first and falls
        back down the tiers until one works — chat only fails if every model is
        out. Picking a specific model pins it (no fallback). Live status only
        updates when you click <strong>Re-check</strong> (each probe costs 1
        request on models that answer — rejected probes are free). Retired
        models are hidden.
        {data?.concludeModel && (
          <>
            {" "}Conclude goes the other way: lowest-tier model first, moving up
            only when needed (starts at <strong>{data.concludeModel}</strong>).
          </>
        )}
      </p>

      {error && <p className="conclusion-error">{error}</p>}

      <section className="usage-card health-card">
        <div className="usage-head">
          <span className="usage-title">
            {health && health.results.length > 0
              ? `Live check (checked ${checkedLabel})`
              : "Live check: not run yet"}
          </span>
          <button
            type="button"
            className="model-switch"
            disabled={checking}
            onClick={() => loadHealth(true)}
          >
            {checking ? "Checking…" : "Re-check"}
          </button>
        </div>
        {health && health.results.length > 0 ? (
          <p className="health-counts">
            <span className="health-count ok">{counts.ok} available</span>
            <span className="health-count quota">{counts.quota} ran out</span>
            <span className="health-count busy">{counts.busy} busy</span>
            {counts.other > 0 && (
              <span className="health-count other">{counts.other} unchecked</span>
            )}
          </p>
        ) : (
          <p className="usage-sub" style={{ marginTop: 8 }}>
            Click Re-check to probe every model now (~20s, costs 1 request per
            answering model).
          </p>
        )}
      </section>

      <section className="usage-card">
        <span className="usage-title">Daily capacity (free tier, per model ≈ {limit})</span>
        <ul className="models-capacity">
          <li>
            <strong>{visible.length}</strong> shown models → up to{" "}
            <strong>{visible.length * limit}</strong> calls/day total
          </li>
          <li>
            <strong>{visionConfirmed.length}</strong> with confirmed image support → up
            to <strong>{visionConfirmed.length * limit}</strong> image uploads/day
          </li>
          <li>
            <strong>{liteModels.length}</strong> lower-tier (flash/lite) models → up to{" "}
            <strong>{liteModels.length * limit}</strong> text-only Conclude calls/day
          </li>
        </ul>
      </section>

      <div className="models-list">
        <div className={`model-row${autoMode ? " current" : ""}`}>
          <div className="model-info">
            <span className="model-label">Auto — best available</span>
            <span className="model-name">tries best model first, falls back down the tiers</span>
            <span className="model-tags">
              <span className="model-tag tier-lite">auto</span>
              {autoMode && <span className="model-tag state">Active</span>}
            </span>
          </div>
          <div className="model-meter">
            <span className="model-used">fallback chain</span>
          </div>
          <button
            type="button"
            className="model-switch"
            disabled={autoMode || switching !== null}
            onClick={() => switchTo("auto")}
          >
            {autoMode ? "Active" : switching === "auto" ? "Switching…" : "Use"}
          </button>
        </div>
        {visible.map((model) => {
          const live = healthByModel.get(model.name);
          const exhausted =
            live?.status === "quota" ||
            (live?.status !== "ok" &&
              (model.exhaustedByApi || model.used >= limit));
          const current = model.name === data?.current;
          const pct = Math.min(100, Math.round((model.used / limit) * 100));
          const state = exhausted
            ? live?.status === "quota" || model.exhaustedByApi
              ? "Ran out (API)"
              : "Ran out"
            : current
              ? "Active"
              : live?.status === "ok"
                ? "Available"
                : live?.status === "busy"
                  ? "Busy"
                  : live
                    ? "Unchecked"
                    : "Unchecked";
          return (
            <div
              key={model.name}
              className={`model-row${exhausted ? " disabled" : ""}${current ? " current" : ""}`}
            >
              <div className="model-info">
                <span className="model-label">{model.label}</span>
                <span className="model-name">{model.name}</span>
                <span className="model-tags">
                  <span className={`model-tag tier-${model.tier}`}>{model.tier}</span>
                  <span
                    className="model-tag"
                    title={
                      model.vision === "yes"
                        ? "Confirmed image support"
                        : "Image support not confirmed"
                    }
                  >
                    {model.vision === "yes" ? "vision ✓" : "vision ?"}
                  </span>
                  <span
                    className={`model-tag state state-${live?.status ?? "none"}${
                      exhausted ? " exhausted" : ""
                    }${state === "Available" ? " ok" : ""}`}
                  >
                    {state}
                  </span>
                  {live && live.status !== "ok" && live.detail && (
                    <span className="model-tag detail">{live.detail}</span>
                  )}
                </span>
              </div>
              <div className="model-meter">
                <div className="usage-track">
                  <div
                    className={`usage-fill${pct >= 90 ? " warn" : ""}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="model-used">
                  {model.used} / {limit}
                </span>
              </div>
              <button
                type="button"
                className="model-switch"
                disabled={exhausted || current || switching !== null}
                onClick={() => switchTo(model.name)}
              >
                {current ? "Active" : switching === model.name ? "Switching…" : "Use"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
