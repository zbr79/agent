"use client";

import { useCallback, useEffect, useState } from "react";
import type { SavedRecord } from "@/lib/types";
import { deleteGuestRecord, listGuestRecords } from "@/lib/guestStore";
import { isMealRelatedItem } from "@/lib/groupMeals";
import { STR, useUiLang } from "@/lib/i18n";

function rankClass(rank: string): string {
  const clean = rank.trim().toLowerCase();
  if (clean === "低" || clean === "low") return "low";
  if (clean === "中" || clean === "medium") return "mid";
  if (clean === "高" || clean === "high") return "high";
  return "none";
}

function toSavedRecord(record: {
  id: string;
  title: string;
  summary: string;
  items: SavedRecord["items"];
  meals?: SavedRecord["meals"];
  sourceText?: string;
  savedAt: string;
}): SavedRecord {
  return {
    _id: record.id,
    title: record.title,
    summary: record.summary,
    items: record.items,
    meals: record.meals,
    sourceText: record.sourceText,
    savedAt: record.savedAt,
    datetime: null,
  };
}

interface TimelineEntry {
  record: SavedRecord;
  ts: number;
  dateKey: string;
}

function dayKeyOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function entryFor(record: SavedRecord): TimelineEntry {
  // Always position the record by its own time (datetime = when it was
  // concluded/saved). Meal/photo times stay visible inside the entry
  // content but never drive the timeline grouping.
  const own = record.datetime ?? record.savedAt;
  return {
    record,
    ts: new Date(own).getTime(),
    dateKey: dayKeyOf(own),
  };
}

function dayLabel(
  dateKey: string,
  lang: "zh" | "en",
  t: Record<string, string>
): string {
  const now = new Date();
  const today = dayKeyOf(now.toISOString());
  const yesterday = dayKeyOf(new Date(now.getTime() - 86400000).toISOString());
  if (dateKey === today) return t["records.today"];
  if (dateKey === yesterday) return t["records.yesterday"];
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(lang === "zh" ? "zh-CN" : [], {
    month: "short",
    day: "numeric",
  });
}

export default function RecordsPanel() {
  const [guest, setGuest] = useState<boolean | null>(null);
  const [records, setRecords] = useState<SavedRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const lang = useUiLang();
  const t = STR[lang];

  const load = useCallback(async () => {
    if (guest === null) return;
    if (guest) {
      setRecords(listGuestRecords().map(toSavedRecord));
      setError(null);
      return;
    }
    try {
      const response = await fetch("/api/records");
      const body = await response.json();
       if (!response.ok) throw new Error(t["common.requestFailed"]);
      setRecords(body.records);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t["common.requestFailed"]);
    }
  }, [guest, lang]);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((response) => {
        if (alive) setGuest(response.status !== 200);
      })
      .catch(() => {
        if (alive) setGuest(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    if (deleting || guest === null) return;
    setDeleting(id);
    try {
      if (guest) {
        deleteGuestRecord(id);
        setRecords((prev) => prev?.filter((record) => record._id !== id) ?? null);
      } else {
        const response = await fetch(`/api/records?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        const body = await response.json();
         if (!response.ok) throw new Error(t["common.requestFailed"]);
        setRecords((prev) => prev?.filter((record) => record._id !== id) ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t["common.requestFailed"]);
    } finally {
      setDeleting(null);
    }
  };

  const groups: { key: string; label: string; entries: TimelineEntry[] }[] = [];
  if (records) {
    const sorted = records.map(entryFor).sort((a, b) => b.ts - a.ts);
    for (const entry of sorted) {
      const last = groups[groups.length - 1];
      if (last && last.key === entry.dateKey) {
        last.entries.push(entry);
      } else {
        groups.push({
          key: entry.dateKey,
           label: dayLabel(entry.dateKey, lang, t),
          entries: [entry],
        });
      }
    }
  }

  return (
    <div className="usage-page">
      <h2>{t["records.title"]}</h2>
      <p className="usage-sub">
        {guest === true ? t["records.subGuest"] : t["records.subOwner"]}
      </p>

      {error && <p className="conclusion-error">{error}</p>}

      {records === null && !error && (
        <p className="usage-sub">{t["records.loading"]}</p>
      )}

      {records !== null && records.length === 0 && (
        <section className="usage-card">
          <span className="usage-title">{t["records.empty"]}</span>
        </section>
      )}

      <div className="timeline">
        {groups.map((group) => (
          <div key={group.key} className="timeline-day-group">
            <div className="timeline-day">{group.label}</div>
            {group.entries.map(({ record }) => {
              const readings = record.items.filter(
                (item) => !isMealRelatedItem(item.name)
              );
              return (
              <div key={record._id} className="timeline-entry">
                <span className="timeline-dot" aria-hidden="true" />
                <div className="timeline-content">
                  {readings.length > 0 && (
                    <div className="timeline-readings">
                      {readings.map((item, index) => (
                        <span key={index} className="timeline-reading">
                          {item.name}
                          {item.value ? ` ${item.value}` : ""}
                          {item.unit ? ` ${item.unit}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {record.meals && record.meals.length > 0 ? (
                    record.meals.map((meal, index) => (
                      <div key={index} className="timeline-meal">
                        <span className="meal-name">{meal.name}</span>
                        {meal.time && (
                          <span className="meal-time">{meal.time}</span>
                        )}
                        {(meal.dishes ?? []).length > 0 ? (
                          <span className="dish-grid">
                            {meal.dishes!.map((dish, dishIndex) => (
                              <span
                                key={dishIndex}
                                className={`dish-box${dish.rank ? ` rank-${rankClass(dish.rank)}` : ""}`}
                              >
                                <span className="dish-box-name">{dish.name}</span>
                                {dish.rank && (
                                  <span className="dish-box-rank">{dish.rank}</span>
                                )}
                              </span>
                            ))}
                          </span>
                        ) : (
                          meal.foods && <span className="meal-foods">{meal.foods}</span>
                        )}
                      </div>
                    ))
                  ) : (
                    readings.length === 0 && (
                      <ul className="conclusion-items">
                        {record.items.map((item, index) => (
                          <li key={index}>
                            <span className="item-name">{item.name}</span>
                            {item.value && (
                              <span className="item-value">{item.value}</span>
                            )}
                            {item.unit && (
                              <span className="item-unit">{item.unit}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                  <button
                    type="button"
                    className="record-delete"
                    disabled={deleting !== null}
                    onClick={() => remove(record._id)}
                  >
                    {deleting === record._id ? t["records.deleting"] : t["records.delete"]}
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
