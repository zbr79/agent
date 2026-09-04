"use client";

import { useState } from "react";
import type { ConcludeResult } from "@/lib/types";
import { addGuestRecord } from "@/lib/guestStore";
import { groupMeals, isMealRelatedItem } from "@/lib/groupMeals";
import { STR, useUiLang } from "@/lib/i18n";

function rankClass(rank: string): string {
  const clean = rank.trim().toLowerCase();
  if (clean === "低" || clean === "low") return "low";
  if (clean === "中" || clean === "medium") return "mid";
  if (clean === "高" || clean === "high") return "high";
  return "none";
}

export default function SummaryCard({
  result,
  sourceText,
  guest = false,
  saved = false,
}: {
  result: ConcludeResult;
  sourceText: string;
  guest?: boolean;
  saved?: boolean;
}) {
  const lang = useUiLang();
  const t = STR[lang];
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedLocal, setSavedLocal] = useState(false);

  const isSaved = saved || savedLocal;

  const reportTitle = t["summary.report"];
  const saveLabels = {
    idle: t["summary.save"],
    busy: t["summary.saving"],
    done: t["summary.saved"],
  };

  const save = async () => {
    if (saving || isSaved) return;
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
        setSavedLocal(true);
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
          throw new Error(t["summary.saveFailed"]);
        }
        setSavedLocal(true);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t["summary.saveFailed"]);
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
disabled={saving || isSaved}
              >
              {isSaved ? saveLabels.done : saving ? saveLabels.busy : saveLabels.idle}
            </button>
            {saveError && <span className="conclusion-error">{saveError}</span>}
          </div>
        </div>
        {meals.map((meal, index) => (
          <div key={index} className="conclusion-meal">
            <div className="meal-name">{meal.name}</div>
            {meal.time && <div className="meal-time">{meal.time}</div>}
            {(meal.dishes ?? []).length > 0 ? (
              <div className="dish-grid">
                {meal.dishes!.map((dish, dishIndex) => (
                  <span key={dishIndex} className={`dish-box${dish.rank ? ` rank-${rankClass(dish.rank)}` : ""}`}>
                    <span className="dish-box-name">{dish.name}</span>
                    {dish.rank && <span className="dish-box-rank">{dish.rank}</span>}
                  </span>
                ))}
              </div>
            ) : (
              meal.foods && <div className="meal-foods">{meal.foods}</div>
            )}
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
