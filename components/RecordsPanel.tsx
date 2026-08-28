"use client";

import { useCallback, useEffect, useState } from "react";
import type { SavedRecord } from "@/lib/types";
import { deleteGuestRecord, listGuestRecords } from "@/lib/guestStore";
import { parseMealDateTime } from "@/lib/mealTime";

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
  timeLabel: string | null;
}

function dayKeyOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function entryFor(record: SavedRecord): TimelineEntry {
  const firstMealTime =
    record.meals
      ?.map((meal) => meal.time)
      .find((time): time is string => !!time) ??
    record.items.find((item) => item.name === "时间")?.value;
  const parsed = firstMealTime ? parseMealDateTime(firstMealTime) : null;
  if (parsed) {
    return {
      record,
      ts: parsed.tsLocal,
      dateKey: parsed.dateKey,
      timeLabel: parsed.timeLabel,
    };
  }
  const fallback = record.datetime ?? record.savedAt;
  return {
    record,
    ts: new Date(fallback).getTime(),
    dateKey: dayKeyOf(fallback),
    timeLabel: null,
  };
}

function dayLabel(dateKey: string): string {
  const now = new Date();
  const today = dayKeyOf(now.toISOString());
  const yesterday = dayKeyOf(new Date(now.getTime() - 86400000).toISOString());
  if (dateKey === today) return "Today";
  if (dateKey === yesterday) return "Yesterday";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export default function RecordsPanel() {
  const [guest, setGuest] = useState<boolean | null>(null);
  const [records, setRecords] = useState<SavedRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

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
      if (!response.ok) throw new Error(body?.error ?? "Could not load records.");
      setRecords(body.records);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load records.");
    }
  }, [guest]);

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
        if (!response.ok) throw new Error(body?.error ?? "Delete failed.");
        setRecords((prev) => prev?.filter((record) => record._id !== id) ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
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
          label: dayLabel(entry.dateKey),
          entries: [entry],
        });
      }
    }
  }

  return (
    <div className="usage-page">
      <h2>Records</h2>
      <p className="usage-sub">
        {guest === true
          ? "Saved reports (guest mode — stored on this device only)."
          : "Saved reports on a timeline. Newest first."}
      </p>

      {error && <p className="conclusion-error">{error}</p>}

      {records === null && !error && <p className="usage-sub">Loading…</p>}

      {records !== null && records.length === 0 && (
        <section className="usage-card">
          <span className="usage-title">
            Nothing saved yet — chat, then click Conclude and Save.
          </span>
        </section>
      )}

      <div className="timeline">
        {groups.map((group) => (
          <div key={group.key} className="timeline-day-group">
            <div className="timeline-day">{group.label}</div>
            {group.entries.map(({ record, timeLabel }) => (
              <div key={record._id} className="timeline-entry">
                <span className="timeline-dot" aria-hidden="true" />
                <div className="timeline-content">
                  {timeLabel && <span className="timeline-time">{timeLabel}</span>}
                  {record.meals && record.meals.length > 0 ? (
                    record.meals.map((meal, index) => (
                      <div key={index} className="timeline-meal">
                        <span className="meal-name">{meal.name}</span>
                        {meal.foods && (
                          <span className="meal-foods">{meal.foods}</span>
                        )}
                      </div>
                    ))
                  ) : (
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
                  )}
                  <button
                    type="button"
                    className="record-delete"
                    disabled={deleting !== null}
                    onClick={() => remove(record._id)}
                  >
                    {deleting === record._id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
