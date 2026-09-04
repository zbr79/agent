"use client";

import { useEffect, useState } from "react";
import type { ConcludeResult } from "@/lib/types";
import { addGuestRecord, updateGuestRecord } from "@/lib/guestStore";
import { STR, useUiLang } from "@/lib/i18n";
import { formatDateTimeDisplay, parseFlexibleDateTime } from "@/lib/mealTime";
import { X } from "lucide-react";

const RANK_OPTIONS = ["低", "中", "高", "low", "medium", "high"];

function isTimeItem(name: string): boolean {
  return /^(时间|time|timestamp|date|when)$/i.test(name.trim());
}

// Native date + time pickers that write back the app's display format
// (e.g. "2026年9月3日 下午 6:17"). Remounts via `key` when the stored value
// changes so the pickers always reflect the latest model output.
function DateTimeInputs({
  value,
  lang,
  onDisplay,
}: {
  value: string | undefined;
  lang: "zh" | "en";
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
    <div className="conclude-row">
      <input
        type="date"
        className="conclude-input conclude-input-date"
        value={date}
        onChange={(event) => {
          setDate(event.target.value);
          commit(event.target.value, time);
        }}
        aria-label="date"
      />
      <input
        type="time"
        className="conclude-input conclude-input-time"
        value={time}
        onChange={(event) => {
          setTime(event.target.value);
          commit(date, event.target.value);
        }}
        aria-label="time"
      />
    </div>
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
  // Each glucose/insulin reading = one entry { value, unit, time } — the
  // conclusion accumulates readings across the whole conversation.
  const [readings, setReadings] = useState<{ value: string; unit: string; time: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !result) return;
    setItems(result.items.map((item) => ({ ...item })));
    setMeals((result.meals ?? []).map((meal) => ({ ...meal })));
    // Pair each 血糖/胰岛素 item with the 时间 item that follows it.
    const paired: { value: string; unit: string; time: string }[] = [];
    let pending: { value: string; unit: string } | null = null;
    for (const item of result.items) {
      if (/^血糖|glucose|胰岛素|insulin$/i.test(item.name.trim())) {
        if (pending) paired.push({ ...pending, time: "" });
        pending = { value: item.value ?? "", unit: item.unit ?? "mg/dL" };
      } else if (isTimeItem(item.name) && pending) {
        paired.push({ ...pending, time: item.value ?? "" });
        pending = null;
      }
    }
    if (pending) paired.push({ ...pending, time: "" });
    setReadings(paired.length ? paired : [{ value: "", unit: "mg/dL", time: "" }]);
    setError(null);
  }, [open, result]);

  if (!open || !result) return null;

  const glucoseName = lang === "zh" ? "血糖" : "glucose";
  const timeName = lang === "zh" ? "时间" : "time";

  const setReading = (index: number, patch: Partial<{ value: string; unit: string; time: string }>) => {
    setReadings((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addReading = () => {
    setReadings((prev) => [...prev, { value: "", unit: "mg/dL", time: "" }]);
  };

  const removeReading = (index: number) => {
    setReadings((prev) => prev.filter((_, i) => i !== index));
  };

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

  const addDish = (mealIndex: number) => {
    setMeals((prev) =>
      prev.map((meal, i) =>
        i === mealIndex
          ? { ...meal, dishes: [...(meal.dishes ?? []), { name: "" }] }
          : meal
      )
    );
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

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const firstMealName = meals.find((meal) => meal.name.trim())?.name.trim();
    const builtItems: ConcludeResult["items"] = [];
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
      <div className="conclude-modal" role="dialog" aria-modal="true">
        <div className="conclude-modal-head">
          <span className="settings-title">{t["concludeModal.title"]}</span>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label={t["actions.cancel"]}
          >
            <X size={16} />
          </button>
        </div>

        {meals.length > 0 && (
          <div className="conclude-section">
            <span className="conclude-section-label">{t["concludeModal.meals"]}</span>
            {meals.map((meal, index) => (
              <div key={index} className="conclude-meal-block">
                <input
                  className="conclude-input conclude-meal-name"
                  value={meal.name}
                  onChange={(event) => setMeal(index, { name: event.target.value })}
                  aria-label={t["concludeModal.mealName"]}
                  placeholder={t["concludeModal.mealName"]}
                />
                <DateTimeInputs
                  key={`meal-${index}-${meal.time ?? ""}`}
                  value={meal.time}
                  lang={lang}
                  onDisplay={(display) => setMeal(index, { time: display })}
                />
                <div className="conclude-dishes">
                  {(meal.dishes ?? []).map((dish, dishIndex) => (
                    <div key={dishIndex} className="conclude-row conclude-dish-row">
                      <input
                        className="conclude-input conclude-input-name"
                        value={dish.name}
                        onChange={(event) =>
                          setDish(index, dishIndex, { name: event.target.value })
                        }
                        aria-label={t["concludeModal.name"]}
                      />
                      <select
                        className="conclude-input conclude-input-value"
                        value={dish.rank ?? ""}
                        onChange={(event) =>
                          setDish(index, dishIndex, {
                            rank: event.target.value || undefined,
                          })
                        }
                        aria-label={t["concludeModal.ranking"]}
                      >
                        <option value="">—</option>
                        {RANK_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="conclude-dish-remove"
                        onClick={() => removeDish(index, dishIndex)}
                        aria-label={t["concludeModal.removeDish"]}
                        title={t["concludeModal.removeDish"]}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="conclude-add-dish"
                    onClick={() => addDish(index)}
                  >
                    {t["concludeModal.addDish"]}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <div className="conclude-section">
            <span className="conclude-section-label">{t["concludeModal.items"]}</span>
            <div className="conclude-meal-block">
              {readings.map((reading, index) => (
                <div key={index} className="conclude-reading-block">
                  <div className="conclude-row">
                    <span className="conclude-glucose-name">{glucoseName}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      className="conclude-input conclude-input-value"
                      value={reading.value}
                      onChange={(event) => setReading(index, { value: event.target.value })}
                      aria-label={t["concludeModal.value"]}
                      placeholder="0"
                    />
                    <input
                      className="conclude-input conclude-input-unit"
                      value={reading.unit}
                      onChange={(event) => setReading(index, { unit: event.target.value })}
                      aria-label={t["concludeModal.unit"]}
                    />
                    <button
                      type="button"
                      className="conclude-dish-remove"
                      onClick={() => removeReading(index)}
                      aria-label={t["concludeModal.removeDish"]}
                      title={t["concludeModal.removeDish"]}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <DateTimeInputs
                    key={`reading-${index}-${reading.time}`}
                    value={reading.time}
                    lang={lang}
                    onDisplay={(display) => setReading(index, { time: display })}
                  />
                </div>
              ))}
              <button type="button" className="conclude-add-dish" onClick={addReading}>
                {t["concludeModal.addReading"]}
              </button>
            </div>
          </div>
        )}

        {error && <p className="conclusion-error">{error}</p>}

        <div className="conclude-modal-actions">
          <button type="button" className="auth-toggle" onClick={onClose}>
            {t["actions.cancel"]}
          </button>
          <button type="button" className="save-button" onClick={save} disabled={busy}>
            {busy ? t["summary.saving"] : t["summary.save"]}
          </button>
        </div>
      </div>
    </>
  );
}