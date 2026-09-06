"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ConcludeResult } from "@/lib/types";
import { addGuestRecord, updateGuestRecord } from "@/lib/guestStore";
import { STR, useUiLang } from "@/lib/i18n";
import { formatDateTimeDisplay, formatDateTimeNoYear, READING_PHASES, readingPhase, parseFlexibleDateTime, refineMealName } from "@/lib/mealTime";
import { Calendar, ChevronLeft, ChevronRight, Clock, Pencil, Trash2, X } from "lucide-react";

const RANK_CYCLE: Record<string, string[]> = {
  zh: ["低", "中", "高"],
  en: ["low", "medium", "high"],
};

const UNITS = ["mg/dL", "mmol/L"];

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

// ---- inline editors: every field is always editable. Hovering shows a pen;
// clicking swaps the text for a control. Commits bubble up as onCommit. ----

function InlineText({
  value,
  onCommit,
  className,
  ariaLabel,
  inputMode,
  placeholder,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  ariaLabel?: string;
  inputMode?: "text" | "decimal";
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const start = () => {
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    if (draft !== value) onCommit(draft);
    setEditing(false);
  };
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        inputMode={inputMode}
        className={`conclude-inline-input ${className ?? ""}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.stopPropagation();
            setEditing(false);
          }
        }}
        aria-label={ariaLabel}
        placeholder={placeholder}
      />
    );
  }
  return (
    <span
      className={`conclude-inline-text ${className ?? ""}`}
      role="button"
      tabIndex={0}
      onClick={start}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          start();
        }
      }}
    >
      {value || "—"}
      <Pencil size={11} className="edit-pen" aria-hidden="true" />
    </span>
  );
}

function InlineSelect({
  value,
  options,
  onCommit,
  className,
  ariaLabel,
  showPen = true,
}: {
  value: string;
  options: string[];
  onCommit: (next: string) => void;
  className?: string;
  ariaLabel?: string;
  showPen?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        autoFocus
        className={`conclude-inline-select ${className ?? ""}`}
        value={options.includes(value) ? value : value}
        onChange={(event) => {
          onCommit(event.target.value);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setEditing(false);
          }
        }}
        aria-label={ariaLabel}
      >
        {!options.includes(value) && value && <option value={value}>{value}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <span
      className={`conclude-inline-text ${className ?? ""}`}
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setEditing(true);
        }
      }}
    >
      {value}
      {showPen && <Pencil size={11} className="edit-pen" aria-hidden="true" />}
    </span>
  );
}

function InlineTime({
  value,
  lang,
  t,
  onCommit,
  className,
}: {
  value: string;
  lang: "zh" | "en";
  t: Record<string, string>;
  onCommit: (next: string) => void;
  className?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <>
      {pickerOpen && (
        <TimePickerModal
          value={draft}
          lang={lang}
          t={t}
          onDraft={setDraft}
          onCommit={() => {
            onCommit(draft);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <span
        className={`conclude-inline-text ${className ?? ""}`}
        role="button"
        tabIndex={0}
        onClick={() => {
          setDraft(value);
          setPickerOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setDraft(value);
            setPickerOpen(true);
          }
        }}
      >
        {value ? formatDateTimeNoYear(value, lang) : "—"}
        <Pencil size={11} className="edit-pen" aria-hidden="true" />
      </span>
    </>
  );
}

// Time selection lives in its own small modal so editing never resizes the
// main report window, and always offers an explicit exit (取消).
function TimePickerModal({
  value,
  lang,
  t,
  onDraft,
  onCommit,
  onClose,
}: {
  value: string;
  lang: "zh" | "en";
  t: Record<string, string>;
  onDraft: (next: string) => void;
  onCommit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="conclude-time-modal" role="dialog" aria-modal="true">
      <DateTimeInputs value={value} lang={lang} t={t} onDisplay={onDraft} />
      <div className="conclude-time-modal-actions">
        <button type="button" className="conclude-cancel" onClick={onClose}>
          {t["actions.cancel"]}
        </button>
        <button type="button" className="conclude-save" onClick={onCommit}>
          {t["summary.save"]}
        </button>
      </div>
    </div>
  );
}

function InlineUnitStepper({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setEditing(false);
        }
      }}>
        <UnitStepper value={value} onChange={(unit) => onCommit(unit)} />
      </div>
    );
  }
  return (
    <span
      className={`conclude-inline-text ${className ?? ""}`}
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setEditing(true);
        }
      }}
    >
      {value}
      <Pencil size={11} className="edit-pen" aria-hidden="true" />
    </span>
  );
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

// Auto-save: every edit saves immediately. Saves serialize (a save started
// while another is in flight chains after it), so a refresh never loses the
// last edit — there is no debounce window to fall into.
const saveRef = useRef<() => Promise<void>>(async () => undefined);
const saveQueueRef = useRef<Promise<void> | null>(null);
const doSave = (): Promise<void> => {
  const run = () =>
    saveRef.current().finally(() => {
      saveQueueRef.current = null;
    });
  if (saveQueueRef.current) {
    saveQueueRef.current = saveQueueRef.current.then(run, run);
    return saveQueueRef.current;
  }
  saveQueueRef.current = run();
  return saveQueueRef.current;
};
const closeRef = useRef<() => void>(() => undefined);
closeRef.current = () => {
  void doSave().finally(() => onClose());
};

  // Dialog behavior: Escape closes (auto-saving when editing); focus moves
  // into the modal on open and is trapped inside (Tab wraps) while open.
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
        closeRef.current();
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
      } else if (/^(时段|phase)$/i.test(name)) {
        // attach to the pending reading, or the last pushed one (legacy
        // records saved the phase AFTER the time item)
        const target = pending
          ? pending
          : (pairedInsulin[pairedInsulin.length - 1] ?? paired[paired.length - 1]);
        if (target) target.phase = item.value ?? "";
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
    // No fallback card: after the user deletes every reading, the saved
    // conclusion has empty items and a refresh must NOT resurrect a card.
    setReadings(paired);
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
        if (reading.phase) {
          builtItems.push({ name: phaseName, value: reading.phase });
        }
        if (reading.time) {
          builtItems.push({ name: timeName, value: reading.time });
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
        if (reading.phase) {
          builtItems.push({ name: phaseName, value: reading.phase });
        }
        if (reading.time) {
          builtItems.push({ name: timeName, value: reading.time });
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

  // Keep the latest save in a ref so debounced timers always persist the
  // freshest state.
  saveRef.current = save;

  const commitReading = (index: number, patch: Partial<Reading>) => {
    flushSync(() => setReading(index, patch));
    void doSave();
  };

  const commitInsulin = (index: number, patch: Partial<Reading>) => {
    flushSync(() => setInsulin(index, patch));
    void doSave();
  };

  const commitMeal = (
    index: number,
    patch: Partial<NonNullable<ConcludeResult["meals"]>[number]>
  ) => {
    flushSync(() => setMeal(index, patch));
    void doSave();
  };

  const commitDish = (
    mealIndex: number,
    dishIndex: number,
    patch: Partial<{ name: string; rank?: string }>
  ) => {
    flushSync(() => setDish(mealIndex, dishIndex, patch));
    void doSave();
  };

  const removeReadingAuto = (index: number) => {
    flushSync(() => removeReading(index));
    void doSave();
  };

  const removeInsulinAuto = (index: number) => {
    flushSync(() => removeInsulin(index));
    void doSave();
  };

  const removeMealAuto = (index: number) => {
    flushSync(() => removeMeal(index));
    void doSave();
  };

  const removeDishAuto = (mealIndex: number, dishIndex: number) => {
    flushSync(() => removeDish(mealIndex, dishIndex));
    void doSave();
  };

  const cycleRankAuto = (mealIndex: number, dishIndex: number) => {
    flushSync(() => cycleDishRank(mealIndex, dishIndex));
    void doSave();
  };

  return (
    <>
      <div className="settings-backdrop" onClick={() => closeRef.current()} aria-hidden="true" />
      <div className="conclude-modal" role="dialog" aria-modal="true" ref={modalRef}>
        <div className="conclude-modal-head">
          <div className="conclude-modal-head-text">
            <h3 className="conclude-modal-title">{t["concludeModal.title"]}</h3>
          </div>
          <button
            type="button"
            className="conclude-modal-close"
            onClick={() => closeRef.current()}
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

        return entries.map((entry) => {
          if (entry.kind === "meal") {
            const meal = meals[entry.index];
            return (
              <section
                key={`m-${entry.index}`}
                className="conclude-section conclude-section-report"
              >
                <div className="conclude-meal-head">
                  <button
                    type="button"
                    className="conclude-card-remove"
                    onClick={() => removeMealAuto(entry.index)}
                    aria-label={t["concludeModal.removeDish"]}
                    title={t["concludeModal.removeDish"]}
                  >
                    <Trash2 size={14} />
                  </button>
                  <span className="conclude-inline-meal-name">{meal.name}</span>
                  <InlineTime
                    value={meal.time ?? ""}
                    lang={lang}
                    t={t}
                    onCommit={(time) => commitMeal(entry.index, { time })}
                    className="conclude-inline-meal-time"
                  />
                </div>
                <div className="conclude-dishes">
                  {(meal.dishes ?? []).map((dish, dishIndex) => (
                    <div key={dishIndex} className="conclude-dish-row">
                      <button
                        type="button"
                        className="conclude-dish-remove"
                        onClick={() => removeDishAuto(entry.index, dishIndex)}
                        aria-label={t["concludeModal.removeDish"]}
                        title={t["concludeModal.removeDish"]}
                      >
                        <Trash2 size={13} />
                      </button>
                      <InlineText
                        className="conclude-inline-dish-name"
                        value={dish.name}
                        onCommit={(name) =>
                          commitDish(entry.index, dishIndex, { name })
                        }
                        ariaLabel={t["concludeModal.name"]}
                      />
                      <button
                        type="button"
                        className={`conclude-rank-badge ${rankTone(dish.rank)}`}
                        onClick={() => cycleRankAuto(entry.index, dishIndex)}
                        aria-label={t["concludeModal.ranking"]}
                        title={t["concludeModal.ranking"]}
                      >
                        {dish.rank ?? "低"}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          }
          const reading =
            entry.kind === "insulin"
              ? insulins[entry.index]
              : readings[entry.index];
          const label =
            entry.kind === "insulin" ? insulinBaseName() : glucoseName;
          const phase = phaseOf(reading);
          const setter =
            entry.kind === "insulin" ? commitInsulin : commitReading;
          const remover =
            entry.kind === "insulin" ? removeInsulinAuto : removeReadingAuto;
          return (
            <section
              key={`${entry.kind}-${entry.index}`}
              className="conclude-section conclude-section-report"
            >
              <div className="conclude-catalog-head">
                <button
                  type="button"
                  className="conclude-card-remove"
                  onClick={() => remover(entry.index)}
                  aria-label={t["concludeModal.removeDish"]}
                  title={t["concludeModal.removeDish"]}
                >
                  <Trash2 size={14} />
                </button>
                <span className="conclude-glucose-label">
                  {label}
                  <span className="conclude-label-dot">·</span>
                </span>
                <InlineSelect
                  className="conclude-inline-phase"
                  value={phase}
                  options={READING_PHASES[lang]}
                  onCommit={(next) => setter(entry.index, { phase: next })}
                  ariaLabel={t["concludeModal.phase"]}
                  showPen={false}
                />
                <InlineTime
                  value={reading.time}
                  lang={lang}
                  t={t}
                  onCommit={(time) => setter(entry.index, { time })}
                  className="conclude-inline-time"
                />
              </div>
              <div className="conclude-reading-main">
                <div className="conclude-value-cluster">
                  <InlineText
                    className="conclude-inline-value"
                    value={reading.value}
                    inputMode="decimal"
                    onCommit={(next) => setter(entry.index, { value: next })}
                    ariaLabel={t["concludeModal.value"]}
                    placeholder="0"
                  />
                  {entry.kind === "insulin" ? (
                    <InlineUnitStepper
                      value={reading.unit}
                      onCommit={(unit) => setter(entry.index, { unit })}
                      className="conclude-inline-unit"
                    />
                  ) : (
                    <InlineSelect
                      className="conclude-inline-unit"
                      value={reading.unit}
                      options={UNITS}
                      onCommit={(unit) => setter(entry.index, { unit })}
                      ariaLabel={t["concludeModal.unit"]}
                    />
                  )}
                </div>
              </div>
            </section>
          );
        });
      })()}

        {error && <p className="conclusion-error">{error}</p>}
      </div>
    </>
  );
}