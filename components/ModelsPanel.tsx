"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUiText, STR, useUiLang } from "@/lib/i18n";
import { modelLabel } from "@/lib/modelLabels";

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

function detailLabel(
  status: HealthResult["status"],
  t: Record<string, string>
): string {
  if (status === "retired") return t["models.detailUnavailable"];
  if (status === "quota") return t["models.detailQuota"];
  if (status === "busy") return t["models.detailBusy"];
  return status === "error" || status === "empty"
    ? t["common.requestFailed"]
    : t["models.detailUnavailable"];
}

export default function ModelsPanel() {
  const lang = useUiLang();
  const t = STR[lang];
  const [data, setData] = useState<ModelsData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [checking, setChecking] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/models");
      if (!response.ok) throw new Error(t["common.requestFailed"]);
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : t["common.requestFailed"]);
    }
  }, [lang]);

  const loadHealth = useCallback(async (force: boolean) => {
    if (force) setChecking(true);
    try {
      const response = await fetch(force ? "/api/health?force=1" : "/api/health");
      if (!response.ok) throw new Error(t["common.requestFailed"]);
      const body = (await response.json()) as HealthData;
      setHealth(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : t["common.requestFailed"]);
    } finally {
      setChecking(false);
    }
  }, [lang]);

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
      if (!response.ok) throw new Error(t["common.requestFailed"]);
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : t["common.requestFailed"]);
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
    ? new Date(health.cachedAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <div className="usage-page">
      <h2>{t["nav.models"]}</h2>
      <p className="usage-sub">
        {t["models.description"]}
        {data?.concludeModel && (
          <>
            {" "}
            {formatUiText(t["models.concludeDescription"], {
              model: modelLabel(data.concludeModel),
            })}
          </>
        )}
      </p>

      {error && <p className="conclusion-error">{error}</p>}

      <section className="usage-card health-card">
        <div className="usage-head">
          <span className="usage-title">
            {health && health.results.length > 0
              ? formatUiText(t["models.liveChecked"], { time: checkedLabel })
              : t["models.liveNotRun"]}
          </span>
          <button
            type="button"
            className="model-switch"
            disabled={checking}
            onClick={() => loadHealth(true)}
          >
            {checking ? t["models.checking"] : t["models.recheck"]}
          </button>
        </div>
        {health && health.results.length > 0 ? (
          <p className="health-counts">
            <span className="health-count ok">
              {formatUiText(t["models.availableCount"], { count: counts.ok })}
            </span>
            <span className="health-count quota">
              {formatUiText(t["models.limitCount"], { count: counts.quota })}
            </span>
            <span className="health-count busy">
              {formatUiText(t["models.busyCount"], { count: counts.busy })}
            </span>
            {counts.other > 0 && (
              <span className="health-count other">
                {formatUiText(t["models.uncheckedCount"], { count: counts.other })}
              </span>
            )}
          </p>
        ) : (
          <p className="usage-sub" style={{ marginTop: 8 }}>
            {t["models.clickRecheck"]}
          </p>
        )}
      </section>

      <section className="usage-card">
        <span className="usage-title">{t["models.catalogTitle"]}</span>
        <ul className="models-capacity">
          <li>
            {formatUiText(t["models.catalogCount"], { count: visible.length })}
          </li>
          <li>
            {formatUiText(t["models.visionCount"], { count: visionModels.length })}
          </li>
          <li>
            {t["models.imagesAlways"]}
          </li>
        </ul>
      </section>

      <div className="models-list">
        <div className={`model-row${autoMode ? " current" : ""}`}>
          <div className="model-info">
            <span className="model-label">{t["models.autoLabel"]}</span>
            <span className="model-name">{t["models.autoName"]}</span>
            <span className="model-tags">
              <span className="model-tag tier-flash">{t["models.autoTag"]}</span>
              {autoMode && <span className="model-tag state">{t["models.active"]}</span>}
            </span>
          </div>
          <div className="model-meter">
            <span className="model-used">{t["models.fallbackChain"]}</span>
          </div>
          <button
            type="button"
            className="model-switch"
            disabled={autoMode || switching !== null}
            onClick={() => switchTo("auto")}
          >
            {autoMode
              ? t["models.active"]
              : switching === "auto"
                ? t["models.switching"]
                : t["models.use"]}
          </button>
        </div>
        {visible.map((model) => {
          const live = healthByModel.get(model.name);
          const current = model.name === data?.current;
          const state = current
            ? t["models.active"]
            : live?.status === "ok"
              ? t["models.available"]
              : live?.status === "quota"
                ? t["models.limitHit"]
                : live?.status === "busy"
                  ? t["models.busy"]
                  : live
                    ? live.status === "empty" || live.status === "error"
                      ? t["models.error"]
                      : t["models.unchecked"]
                    : t["models.unchecked"];
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
                  <span className={`model-tag tier-${model.tier}`}>
                    {t[model.tier === "pro" ? "models.tierPro" : "models.tierFlash"]}
                  </span>
                  {model.vision && (
                      <span className="model-tag" title={t["models.vision"]}>
                        {t["models.vision"]}
                    </span>
                  )}
                   <span className={`model-tag state state-${live?.status ?? "none"}${live?.status === "ok" ? " ok" : ""}`}>
                     {state}
                   </span>
                   {live && live.status !== "ok" && live.detail && (
                     <span className="model-tag detail">
                       {detailLabel(live.status, t)}
                     </span>
                  )}
                </span>
              </div>
              <div className="model-meter">
                <span className="model-used">
                  {live
                    ? formatUiText(t["models.probe"], { ms: live.ms })
                    : t["models.notChecked"]}
                </span>
              </div>
              <button
                type="button"
                className="model-switch"
                disabled={disabled || switching !== null}
                onClick={() => switchTo(model.name)}
              >
                 {current
                   ? t["models.active"]
                   : switching === model.name
                     ? t["models.switching"]
                     : t["models.use"]}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
