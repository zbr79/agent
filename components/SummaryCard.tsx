"use client";

import { useState } from "react";
import type { ConcludeResult } from "@/lib/types";
import { addGuestRecord } from "@/lib/guestStore";
import { groupMeals, isMealRelatedItem } from "@/lib/groupMeals";

export default function SummaryCard({
  result,
  sourceText,
  guest = false,
}: {
  result: ConcludeResult;
  sourceText: string;
  guest?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isChinese = /[\u4e00-\u9fff]/.test(`${result.title} ${result.summary}`);
  const reportTitle = isChinese ? "报告" : "Report";
  const saveLabels = isChinese
    ? { idle: "保存", busy: "保存中…", done: "已保存" }
    : { idle: "Save", busy: "Saving…", done: "Saved" };

  const save = async () => {
    if (saving || saved) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (guest) {
        addGuestRecord({
          title: reportTitle,
          summary: result.summary,
          items: result.items,
          meals: result.meals,
          sourceText,
        });
        setSaved(true);
      } else {
        const response = await fetch("/api/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: reportTitle,
            summary: result.summary,
            items: result.items,
            meals: result.meals,
            sourceText,
          }),
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body?.error ?? "Save failed.");
        }
        setSaved(true);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const grouped =
    result.meals && result.meals.length
      ? {
          meals: result.meals,
          extras: result.items.filter(
            (item) => !isMealRelatedItem(item.name)
          ),
        }
      : groupMeals(result.items);
  const { meals, extras } = grouped;

  return (
    <div className="summary-row">
      <div className="conclusion-card">
        <div className="conclusion-head">
          <strong>{reportTitle}</strong>
          <div className="conclusion-head-actions">
            <button
              type="button"
              className="save-button"
              onClick={save}
              disabled={saving || saved}
            >
              {saved ? saveLabels.done : saving ? saveLabels.busy : saveLabels.idle}
            </button>
            {saveError && <span className="conclusion-error">{saveError}</span>}
          </div>
        </div>
        {meals.map((meal, index) => (
          <div key={index} className="conclusion-meal">
            <div className="meal-name">{meal.name}</div>
            {meal.foods && <div className="meal-foods">{meal.foods}</div>}
            {meal.time && <div className="meal-time">{meal.time}</div>}
          </div>
        ))}
        {extras.length > 0 && (
          <ul className="conclusion-items">
            {extras.map((item, index) => (
              <li key={index}>
                <span className="item-name">{item.name}</span>
                {item.value && <span className="item-value">{item.value}</span>}
                {item.unit && <span className="item-unit">{item.unit}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
