"use client";

import { useCallback, useEffect, useState } from "react";

interface ModelRow {
  name: string;
  label: string;
  tier: "pro" | "flash";
  vision: boolean;
  retired: boolean;
}

interface ModelsData {
  current: string;
  concludeModel?: string;
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
  const autoMode = data?.current === "auto";
  const healthByModel = new Map((health?.results ?? []).map((r) => [r.model, r]));
  const visible = models.filter(
    (model) => !model.retired && healthByModel.get(model.name)?.status !== "retired"
  );
  const visionModels = visible.filter((model) => model.vision);

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
        <strong>Auto</strong> (default): text chat uses DeepSeek V4 Pro with
        DeepSeek V4 Flash as fallback, then every free model (DeepSeek V4
        Flash Free, Nemotron 3 Ultra, Nemotron 3.5 Lightning, Ling 3.0 Flash,
        MiMo-V2.5, Big Pickle, Laguna S 2.1) when a paid model is exhausted or
        fails. Picking a specific model pins it for text chats. Images always
        route to DeepSeek V4 Flash Vision Exp (the Go plan&apos;s vision
        model). Live status only updates when you click{" "}
        <strong>Re-check</strong> (each probe costs a tiny request on models
        that answer).
        {data?.concludeModel && (
          <>
            {" "}Conclude uses <strong>{data.concludeModel}</strong> first, then
            the next model in its chain.
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
            <span className="health-count quota">{counts.quota} limit hit</span>
            <span className="health-count busy">{counts.busy} busy</span>
            {counts.other > 0 && (
              <span className="health-count other">{counts.other} unchecked</span>
            )}
          </p>
        ) : (
          <p className="usage-sub" style={{ marginTop: 8 }}>
            Click Re-check to probe every model now (~30s, costs one tiny
            request per answering model).
          </p>
        )}
      </section>

      <section className="usage-card">
        <span className="usage-title">Catalog (opencode-go + free)</span>
        <ul className="models-capacity">
          <li>
            <strong>{visible.length}</strong> models on the Go plan plus the
            free gateway via the chat/completions endpoint
          </li>
          <li>
            <strong>{visionModels.length}</strong> with image input support
            (vision flags from vendor docs)
          </li>
          <li>
            Images in chat always use <strong>deepseek-v4-flash-vision-exp</strong>
          </li>
        </ul>
      </section>

      <div className="models-list">
        <div className={`model-row${autoMode ? " current" : ""}`}>
          <div className="model-info">
            <span className="model-label">Auto — best available</span>
            <span className="model-name">text: deepseek-v4-pro → deepseek-v4-flash → 7 free models; images: vision-exp</span>
            <span className="model-tags">
              <span className="model-tag tier-flash">auto</span>
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
          const current = model.name === data?.current;
          const state = current
            ? "Active"
            : live?.status === "ok"
              ? "Available"
              : live?.status === "quota"
                ? "Limit hit"
                : live?.status === "busy"
                  ? "Busy"
                  : live
                    ? live.status === "empty" || live.status === "error"
                      ? "Error"
                      : "Unchecked"
                    : "Unchecked";
          const disabled = current || live?.status === "quota";
          return (
            <div
              key={model.name}
              className={`model-row${current ? " current" : ""}${disabled ? " disabled" : ""}`}
            >
              <div className="model-info">
                <span className="model-label">{model.label}</span>
                <span className="model-name">{model.name}</span>
                <span className="model-tags">
                  <span className={`model-tag tier-${model.tier}`}>{model.tier}</span>
                  {model.vision && (
                    <span className="model-tag" title="Image input supported">
                      vision ✓
                    </span>
                  )}
                  <span className={`model-tag state state-${live?.status ?? "none"}${state === "Available" ? " ok" : ""}`}>
                    {state}
                  </span>
                  {live && live.status !== "ok" && live.detail && (
                    <span className="model-tag detail">{live.detail}</span>
                  )}
                </span>
              </div>
              <div className="model-meter">
                <span className="model-used">
                  {live ? `${live.ms}ms probe` : "—"}
                </span>
              </div>
              <button
                type="button"
                className="model-switch"
                disabled={disabled || switching !== null}
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
