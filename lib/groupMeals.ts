import type { ConcludeItem } from "./types";

export interface MealGroup {
  name: string;
  foods?: string;
  time?: string;
}

const MEAL_NAMES = new Set([
  "早餐",
  "午餐",
  "晚餐",
  "加餐",
  "breakfast",
  "lunch",
  "dinner",
  "snack",
]);
const TIME_NAMES = new Set(["时间", "time"]);
const FOOD_NAMES = new Set(["食物", "foods"]);

export function isMealRelatedItem(name: string): boolean {
  const clean = typeof name === "string" ? name.trim() : "";
  return MEAL_NAMES.has(clean) || TIME_NAMES.has(clean) || FOOD_NAMES.has(clean);
}

// Flat conclude items come in pairs like [晚餐(foods), 时间, 午餐(foods), 时间].
// Group each meal name with its foods and time into one block so N meals
// read as N meals instead of 2N flat rows.
export function groupMeals(items: ConcludeItem[]): {
  meals: MealGroup[];
  extras: ConcludeItem[];
} {
  const meals: MealGroup[] = [];
  const extras: ConcludeItem[] = [];
  let current: MealGroup | null = null;
  for (const item of items) {
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (MEAL_NAMES.has(name)) {
      current = { name, foods: item.value };
      meals.push(current);
    } else if (current && TIME_NAMES.has(name) && item.value) {
      if (!current.time) current.time = item.value;
    } else if (current && FOOD_NAMES.has(name) && item.value) {
      current.foods = current.foods
        ? `${current.foods}, ${item.value}`
        : item.value;
    } else {
      extras.push(item);
    }
  }
  return { meals, extras };
}
