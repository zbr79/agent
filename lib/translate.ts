import type { ConcludeItem, ConcludeMeal } from "./types";

export function parseLeadingNumber(value: string): number | undefined {
  const match = value.replace(/,/g, "").match(/^[-+]?\d+(\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

export interface TranslatedRecord {
  title: string;
  summary: string;
  items: ConcludeItem[];
  meals?: ConcludeMeal[];
  datetime: null;
  sourceText?: string;
}

export function translateRecord(input: {
  title: string;
  summary: string;
  items: ConcludeItem[];
  meals?: ConcludeMeal[];
  sourceText?: string;
}): TranslatedRecord {
  const items = input.items.map((item) => {
    const clean: ConcludeItem = { name: item.name };
    if (item.value) clean.value = item.value;
    if (item.unit) clean.unit = item.unit;
    if (item.value !== undefined) {
      const number = parseLeadingNumber(item.value);
      if (number !== undefined) clean.number = number;
    }
    return clean;
  });
  const meals = input.meals?.map((meal) => ({
    name: meal.name,
    ...(meal.foods ? { foods: meal.foods } : {}),
    ...(meal.dishes
      ? {
          dishes: meal.dishes.map((dish) => ({
            name: dish.name,
            ...(dish.rank ? { rank: dish.rank } : {}),
          })),
        }
      : {}),
    ...(meal.time ? { time: meal.time } : {}),
  }));
  // The record's own time (when it was concluded/saved) is assigned at
  // insert time — never derive the timestamp from the photo/chat content,
  // which may describe a different moment.
  return {
    title: input.title,
    summary: input.summary,
    items,
    meals,
    datetime: null,
    sourceText: input.sourceText,
  };
}