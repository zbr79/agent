"use client";

import { useEffect, useRef, useState } from "react";
import type { ConcludeResult } from "@/lib/types";
import { addGuestRecord, updateGuestRecord } from "@/lib/guestStore";
import { STR, useUiLang } from "@/lib/i18n";
import { formatDateTimeDisplay, READING_PHASES, readingPhase, parseFlexibleDateTime, refineMealName } from "@/lib/mealTime";
import { Calendar, ChevronLeft, ChevronRight, Clock, Trash2, X } from "lucide-react";

const RANK_CYCLE: Record<string, string[]> = {
  zh: ["低", "中", "高", ""],
  en: ["low", "medium", "high", ""],
};

const UNITS = ["mg/dL", "mmol/L", "U", "IU", "g", "kg"];

// Insulin units are few — cycle them with left/right steppers instead of a
// dropdown. Custom units typed in old records are kept as-is.
const INSULIN_UNITS = ["U", "IU"];

function UnitStepper({
  value,
  onChange,
}: {
  value: string;
  onChange: (unit: string) => void;
}) {
  const idx = INSULIN_UNITS.indexOf(value);
  const step = (delta: number) => {
    if (idx === -1) return;
    const next = INSULIN_UNITS[(idx + delta + INSULIN_UNITS.length) % INSULIN_UNITS.length];
    onChange(next);
  };
  return (
    <div className="conclude-unit-stepper">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={idx === -1}
        aria-label="previous unit"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="conclude-unit-value">{value}</span>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={idx === -1}
        aria-label="next unit"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function isTimeItem(name: string): boolean {
  return /^(时间|time|timestamp|date|when)$/i.test(name.trim());
}

function rankTone(rank: string | undefined): string {
  const clean = (rank ?? "").trim().toLowerCase();
  if (clean === "低" || clean === "low") return "rank-low";
  if (clean === "中" || clean === "medium") return "rank-mid";
  if (clean === "高" || clean === "high") return "rank-high";
  return "rank-none";
}

function nextRank(current: string | undefined, lang: "zh" | "en"): string {
  const cycle = RANK_CYCLE[lang];
  const idx = cycle.indexOf((current ?? "").trim());
  return cycle[(idx + 1) % cycle.length];
}

// Native date + time pickers styled as chips.
function DateTimeInputs({
  value,
  lang,
  t,
  onDisplay,
}: {
  value: string | undefined;
  lang: "zh" | "en";
  t: Record<string, string>;
  onDisplay: (display: string) => void;
}) {
  const parsed = parseFlexibleDateTime(value ?? "");
  const [date, setDate] = useState(parsed?.date ?? "");
  const [time, setTime] = useState(parsed?.time ?? "");

  const commit = (d: string, t: string) => {
    const display = formatDateTimeDisplay(d, t, lang);
    if (display) onDisplay(display);
  };

  return (
    <div className="conclude-time-row">
      <span className="conclude-time-icon">
        <Clock size={14} />
      </span>
      <input
        type="time"
        className="conclude-time-input"
        value={time}
        onChange={(event) => {
          setTime(event.target.value);
          commit(date, event.target.value);
        }}
        aria-label={t["concludeModal.time"]}
      />
      <span className="conclude-time-icon">
        <Calendar size={14} />
      </span>
      <input
        type="date"
        className="conclude-time-input"
        value={date}
        onChange={(event) => {
          setDate(event.target.value);
          commit(event.target.value, time);
        }}
        aria-label={t["concludeModal.date"]}
      />
    </div>
  );
}

interface Reading {
  value: string;
  unit: string;
  time: string;
  phase?: string;
}

export default function ConcludeModal({
  open,
  result,
  sourceText,
  guest = false,
  recordId = null,
  onClose,
  onSaved,
}: {
  open: boolean;
  result: ConcludeResult | null;
  sourceText: string;
  guest?: boolean;
  recordId?: string | null;
  onClose: () => void;
  onSaved: (edited: ConcludeResult, savedRecordId: string | null) => void;
}) {
  const lang = useUiLang();
  const t = STR[lang];
  const [items, setItems] = useState<ConcludeResult["items"]>([]);
  const [meals, setMeals] = useState<NonNullable<ConcludeResult["meals"]>>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [insulins, setInsulins] = useState<Reading[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Dialog behavior: Escape closes; focus moves into the modal on open and
  // is trapped inside (Tab wraps) while it is open.
  useEffect(() => {
    if (!open) return;
    const focusables = () =>
      Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    const first = () => focusables()[0];
    const last = () => focusables()[focusables().length - 1];
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === firstEl || !modalRef.current?.contains(active))) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && (active === lastEl || !modalRef.current?.contains(active))) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const timer = setTimeout(() => {
      // Land on the first content control (skip the close button).
      const first = focusables().find((el) => !el.classList.contains("conclude-modal-close"));
      (first ?? focusables()[0])?.focus();
    }, 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !result) return;
    setItems(result.items.map((item) => ({ ...item })));
    setMeals(
      (result.meals ?? []).map((meal) => ({
        ...meal,
        // 加餐/Snack → time-based name (早餐/午餐/下午茶/晚餐/夜宵).
        name: refineMealName(meal.name, meal.time, lang),
      }))
    );
    const paired: Reading[] = [];
    const pairedInsulin: Reading[] = [];
    let pending: {
      kind: "glucose" | "insulin";
      value: string;
      unit: string;
      phase?: string;
    } | null = null;
    const pushPending = () => {
      if (!pending) return;
      const target = pending.kind === "insulin" ? pairedInsulin : paired;
      target.push({ value: pending.value, unit: pending.unit, time: "", phase: pending.phase });
      pending = null;
    };
    for (const item of result.items) {
      const name = item.name.trim();
      if (/^(血糖|glucose)$/i.test(name)) {
        pushPending();
        pending = { kind: "glucose", value: item.value ?? "", unit: item.unit ?? "mg/dL" };
      } else if (/^胰岛素|^insulin/i.test(name)) {
        pushPending();
        pending = { kind: "insulin", value: item.value ?? "", unit: item.unit ?? "U" };
      } else if (/^(时段|phase)$/i.test(name) && pending) {
        pending.phase = item.value ?? "";
      } else if (isTimeItem(name) && pending) {
        (pending.kind === "insulin" ? pairedInsulin : paired).push({
          value: pending.value,
          unit: pending.unit,
          time: item.value ?? "",
          phase: pending.phase,
        });
        pending = null;
      }
    }
    pushPending();
    const hasAny = paired.length > 0 || pairedInsulin.length > 0;
    setReadings(paired.length ? paired : hasAny ? [] : [{ value: "", unit: "mg/dL", time: "" }]);
    setInsulins(pairedInsulin);
    setError(null);
  }, [open, result]);

  if (!open || !result) return null;

  const glucoseName = lang === "zh" ? "血糖" : "glucose";
  const timeName = lang === "zh" ? "时间" : "time";
  const phaseName = lang === "zh" ? "时段" : "phase";

  const setReading = (index: number, patch: Partial<Reading>) => {
    setReadings((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeReading = (index: number) => {
    setReadings((prev) => prev.filter((_, i) => i !== index));
  };

  const setInsulin = (index: number, patch: Partial<Reading>) => {
    setInsulins((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeInsulin = (index: number) => {
    setInsulins((prev) => prev.filter((_, i) => i !== index));
  };

  const phaseOf = (reading: Reading): string =>
    reading.phase ?? readingPhase(reading.time, lang);

  const insulinBaseName = (): string => (lang === "zh" ? "胰岛素" : "Insulin");

  const setMeal = (index: number, patch: Partial<NonNullable<ConcludeResult["meals"]>[number]>) => {
    setMeals((prev) => prev.map((meal, i) => (i === index ? { ...meal, ...patch } : meal)));
  };

  const setDish = (
    mealIndex: number,
    dishIndex: number,
    patch: Partial<{ name: string; rank?: string }>
  ) => {
    setMeals((prev) =>
      prev.map((meal, i) =>
        i === mealIndex
          ? {
              ...meal,
              dishes: (meal.dishes ?? []).map((dish, j) =>
                j === dishIndex ? { ...dish, ...patch } : dish
              ),
            }
          : meal
      )
    );
  };

  const cycleDishRank = (mealIndex: number, dishIndex: number) => {
    const dish = meals[mealIndex]?.dishes?.[dishIndex];
    const next = nextRank(dish?.rank, lang);
    setDish(mealIndex, dishIndex, { rank: next || undefined });
  };

  const removeDish = (mealIndex: number, dishIndex: number) => {
    setMeals((prev) =>
      prev.map((meal, i) =>
        i === mealIndex
          ? { ...meal, dishes: (meal.dishes ?? []).filter((_, j) => j !== dishIndex) }
          : meal
      )
    );
  };

  const removeMeal = (mealIndex: number) => {
    setMeals((prev) => prev.filter((_, i) => i !== mealIndex));
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const firstMealName = meals.find((meal) => meal.name.trim())?.name.trim();
    const builtItems: ConcludeResult["items"] = [];
    for (const reading of insulins) {
      if (reading.value.trim()) {
        const item: ConcludeResult["items"][number] = {
          name: insulinBaseName(),
          value: reading.value.trim(),
        };
        if (reading.unit.trim()) item.unit = reading.unit.trim();
        builtItems.push(item);
        if (reading.time) {
          builtItems.push({ name: timeName, value: reading.time });
        }
        if (reading.phase) {
          builtItems.push({ name: phaseName, value: reading.phase });
        }
      }
    }
    for (const reading of readings) {
      if (reading.value.trim()) {
        const item: ConcludeResult["items"][number] = {
          name: glucoseName,
          value: reading.value.trim(),
        };
        if (reading.unit.trim()) item.unit = reading.unit.trim();
        builtItems.push(item);
        if (reading.time) {
          builtItems.push({ name: timeName, value: reading.time });
        }
        if (reading.phase) {
          builtItems.push({ name: phaseName, value: reading.phase });
        }
      }
    }
    const edited: ConcludeResult = {
      title: firstMealName || t["summary.report"],
      summary: result.summary,
      items: builtItems,
      meals: meals.length ? meals : undefined,
    };
    try {
      let savedId: string | null = recordId;
      if (guest) {
        if (recordId) {
          updateGuestRecord(recordId, {
            title: edited.title,
            summary: edited.summary,
            items: edited.items,
            meals: edited.meals,
            sourceText,
          });
        } else {
          const record = addGuestRecord({
            title: edited.title,
            summary: edited.summary,
            items: edited.items,
            meals: edited.meals,
            sourceText,
          });
          savedId = record.id;
        }
      } else {
        const response = await fetch(
          `/api/records${recordId ? `?id=${encodeURIComponent(recordId)}` : ""}`,
          {
            method: recordId ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: edited.title,
              summary: edited.summary,
              items: edited.items,
              meals: edited.meals,
              sourceText,
            }),
          }
        );
        if (!response.ok) {
          throw new Error(t["summary.saveFailed"]);
        }
        if (!recordId) {
          const body = await response.json();
          savedId = body?.record?._id ?? null;
        }
      }
      onSaved(edited, savedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t["summary.saveFailed"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="conclude-modal" role="dialog" aria-modal="true" ref={modalRef}>
        <div className="conclude-modal-head">
          <div className="conclude-modal-head-text">
            <h3 className="conclude-modal-title">{t["concludeModal.title"]}</h3>
          </div>
          <button
            type="button"
            className="conclude-modal-close"
            onClick={onClose}
            aria-label={t["actions.cancel"]}
          >
            <X size={16} />
          </button>
        </div>

        {(() => {
        // Order meals, insulin and glucose readings by time: same time →
        // food (meal) first, then insulin, then glucose; different times →
        // chronological; unparsed times last.
        type Entry =
          | { kind: "meal"; index: number; timeMs: number | null }
          | { kind: "insulin"; index: number; timeMs: number | null }
          | { kind: "reading"; index: number; timeMs: number | null };
        const entryTimeMs = (value: string | undefined): number | null => {
          const parsed = parseFlexibleDateTime(value ?? "");
          if (!parsed) return null;
          return Date.parse(`${parsed.date}T${parsed.time}`);
        };
        const order = { meal: 0, insulin: 1, reading: 2 };
        const entries: Entry[] = [
          ...readings.map((reading, index) => ({
            kind: "reading" as const,
            index,
            timeMs: entryTimeMs(reading.time),
          })),
          ...insulins.map((reading, index) => ({
            kind: "insulin" as const,
            index,
            timeMs: entryTimeMs(reading.time),
          })),
          ...meals.map((meal, index) => ({
            kind: "meal" as const,
            index,
            timeMs: entryTimeMs(meal.time),
          })),
        ].sort((a, b) => {
          if (a.timeMs === null && b.timeMs === null)
            return order[a.kind] - order[b.kind];
          if (a.timeMs === null) return 1;
          if (b.timeMs === null) return -1;
          if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
          return order[a.kind] - order[b.kind];
        });

        return entries.map((entry) =>
          entry.kind === "reading" ? (
            <section key={`r-${entry.index}`} className="conclude-section">
              <div className="conclude-catalog-head">
                <span className="conclude-glucose-label">{glucoseName}</span>
                <button
                  type="button"
                  className="conclude-card-remove"
                  onClick={() => removeReading(entry.index)}
                  aria-label={t["concludeModal.removeDish"]}
                  title={t["concludeModal.removeDish"]}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="conclude-catalog-meta">
                <DateTimeInputs
                  key={`reading-${entry.index}-${readings[entry.index].time}`}
                  value={readings[entry.index].time}
                  lang={lang}
                  t={t}
                  onDisplay={(display) =>
                    setReading(entry.index, { time: display })
                  }
                />
              </div>
              <div className="conclude-reading-main">
                <input
                  type="number"
                  inputMode="decimal"
                  className="conclude-reading-value"
                  value={readings[entry.index].value}
                  onChange={(event) =>
                    setReading(entry.index, { value: event.target.value })
                  }
                  aria-label={t["concludeModal.value"]}
                  placeholder="0"
                />
                <select
                  className="conclude-phase-select"
                  value={phaseOf(readings[entry.index])}
                  onChange={(event) =>
                    setReading(entry.index, { phase: event.target.value })
                  }
                  aria-label={t["concludeModal.phase"]}
                >
                  {READING_PHASES[lang].map((phase) => (
                    <option key={phase} value={phase}>
                      {phase}
                    </option>
                  ))}
                </select>
                <select
                  className="conclude-reading-unit"
                  value={readings[entry.index].unit}
                  onChange={(event) =>
                    setReading(entry.index, { unit: event.target.value })
                  }
                  aria-label={t["concludeModal.unit"]}
                >
                  {UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                  {!UNITS.includes(readings[entry.index].unit) &&
                    readings[entry.index].unit && (
                      <option value={readings[entry.index].unit}>
                        {readings[entry.index].unit}
                      </option>
                    )}
                </select>
              </div>
            </section>
          ) : entry.kind === "insulin" ? (
            <section key={`i-${entry.index}`} className="conclude-section">
              <div className="conclude-catalog-head">
                <span className="conclude-glucose-label">
                  {insulinBaseName()}
                </span>
                <button
                  type="button"
                  className="conclude-card-remove"
                  onClick={() => removeInsulin(entry.index)}
                  aria-label={t["concludeModal.removeDish"]}
                  title={t["concludeModal.removeDish"]}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="conclude-catalog-meta">
                <DateTimeInputs
                  key={`insulin-${entry.index}-${insulins[entry.index].time}`}
                  value={insulins[entry.index].time}
                  lang={lang}
                  t={t}
                  onDisplay={(display) =>
                    setInsulin(entry.index, { time: display })
                  }
                />
              </div>
              <div className="conclude-reading-main">
                <input
                  type="number"
                  inputMode="decimal"
                  className="conclude-reading-value"
                  value={insulins[entry.index].value}
                  onChange={(event) =>
                    setInsulin(entry.index, { value: event.target.value })
                  }
                  aria-label={t["concludeModal.value"]}
                  placeholder="0"
                />
                <select
                  className="conclude-phase-select"
                  value={phaseOf(insulins[entry.index])}
                  onChange={(event) =>
                    setInsulin(entry.index, { phase: event.target.value })
                  }
                  aria-label={t["concludeModal.phase"]}
                >
                  {READING_PHASES[lang].map((phase) => (
                    <option key={phase} value={phase}>
                      {phase}
                    </option>
                  ))}
                </select>
                <UnitStepper
                  value={insulins[entry.index].unit}
                  onChange={(unit) => setInsulin(entry.index, { unit })}
                />
              </div>
            </section>
          ) : (
            <section key={`m-${entry.index}`} className="conclude-section">
              <div className="conclude-meal-head">
                <input
                  className="conclude-meal-name"
                  value={meals[entry.index].name}
                  onChange={(event) =>
                    setMeal(entry.index, { name: event.target.value })
                  }
                  aria-label={t["concludeModal.mealName"]}
                  placeholder={t["concludeModal.mealName"]}
                />
                <DateTimeInputs
                  key={`meal-${entry.index}-${meals[entry.index].time ?? ""}`}
                  value={meals[entry.index].time}
                  lang={lang}
                  t={t}
                  onDisplay={(display) =>
                    setMeal(entry.index, { time: display })
                  }
                />
                <button
                  type="button"
                  className="conclude-card-remove"
                  onClick={() => removeMeal(entry.index)}
                  aria-label={t["concludeModal.removeDish"]}
                  title={t["concludeModal.removeDish"]}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="conclude-dishes">
                {(meals[entry.index].dishes ?? []).map((dish, dishIndex) => (
                  <div key={dishIndex} className="conclude-dish-row">
                    <input
                      className="conclude-dish-name"
                      value={dish.name}
                      onChange={(event) =>
                        setDish(entry.index, dishIndex, {
                          name: event.target.value,
                        })
                      }
                      aria-label={t["concludeModal.name"]}
                      placeholder={t["concludeModal.name"]}
                    />
                    <button
                      type="button"
                      className={`conclude-rank-badge ${rankTone(dish.rank)}`}
                      onClick={() => cycleDishRank(entry.index, dishIndex)}
                      aria-label={t["concludeModal.ranking"]}
                      title={t["concludeModal.ranking"]}
                    >
                      {dish.rank || "—"}
                    </button>
                    <button
                      type="button"
                      className="conclude-dish-remove"
                      onClick={() => removeDish(entry.index, dishIndex)}
                      aria-label={t["concludeModal.removeDish"]}
                      title={t["concludeModal.removeDish"]}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )
        );
      })()}

        {error && <p className="conclusion-error">{error}</p>}

        <div className="conclude-modal-actions">
          <button type="button" className="conclude-cancel" onClick={onClose}>
            {t["actions.cancel"]}
          </button>
          <button type="button" className="conclude-save" onClick={save} disabled={busy}>
            {busy ? t["summary.saving"] : t["summary.save"]}
          </button>
        </div>
      </div>
    </>
  );
}