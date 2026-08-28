import type { ConcludeItem, ConcludeMeal } from "./types";
import { parseMealDateTime } from "./mealTime";

const TIME_ITEM_NAMES = /^(time|timestamp|datetime|date|time of day|when)$/i;

const TIME_OF_DAY: Record<string, [number, number]> = {
  morning: [7, 0],
  dawn: [6, 0],
  noon: [12, 0],
  midday: [12, 0],
  lunch: [12, 0],
  afternoon: [14, 0],
  evening: [19, 0],
  night: [21, 0],
};

export function defaultTimeZone(): string {
  return process.env.RECORD_TIMEZONE || "Asia/Shanghai";
}

export function parseLeadingNumber(value: string): number | undefined {
  const match = value.replace(/,/g, "").match(/^[-+]?\d+(\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

export function parseTimeValue(value: string): [number, number] | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  const word = TIME_OF_DAY[text];
  if (word) return word;

  const hhmm = text.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return [h, m];
    return null;
  }

  const ampm = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    const h = Number(ampm[1]);
    const m = ampm[2] ? Number(ampm[2]) : 0;
    if (h < 1 || h > 12 || m > 59) return null;
    const hour = (h % 12) + (ampm[3] === "pm" ? 12 : 0);
    return [hour, m];
  }

  return null;
}

function tzOffsetMs(timeZone: string, date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    map[part.type] = part.value;
  }
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second)
  );
  return asUTC - date.getTime();
}

export function makeZonedDate(
  timeZone: string,
  hour: number,
  minute: number,
  now = new Date()
): Date {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);
  const wallAsUTC = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  return new Date(wallAsUTC - tzOffsetMs(timeZone, new Date(wallAsUTC)));
}

function zonedDateFromParts(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const wallAsUTC = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  return new Date(wallAsUTC - tzOffsetMs(timeZone, new Date(wallAsUTC)));
}

export interface TranslatedRecord {
  title: string;
  summary: string;
  items: ConcludeItem[];
  meals?: ConcludeMeal[];
  datetime: Date | null;
  sourceText?: string;
}

export function translateRecord(input: {
  title: string;
  summary: string;
  items: ConcludeItem[];
  meals?: ConcludeMeal[];
  sourceText?: string;
}): TranslatedRecord {
  const timeZone = defaultTimeZone();
  let datetime: Date | null = null;
  const items = input.items.map((item) => {
    const clean: ConcludeItem = { name: item.name };
    if (item.value) clean.value = item.value;
    if (item.unit) clean.unit = item.unit;
    if (item.value !== undefined) {
      const number = parseLeadingNumber(item.value);
      if (number !== undefined) clean.number = number;
    }
    if (!datetime && TIME_ITEM_NAMES.test(item.name) && item.value) {
      const parsed = parseTimeValue(item.value);
      if (parsed) datetime = makeZonedDate(timeZone, parsed[0], parsed[1]);
    }
    return clean;
  });
  const meals = input.meals?.map((meal) => ({
    name: meal.name,
    ...(meal.foods ? { foods: meal.foods } : {}),
    ...(meal.time ? { time: meal.time } : {}),
  }));
  if (!datetime && meals && meals.length) {
    const first = meals
      .map((meal) => meal.time)
      .find((time): time is string => !!time);
    if (first) {
      const parts = parseMealDateTime(first);
      if (parts) {
        datetime = zonedDateFromParts(
          timeZone,
          parts.year,
          parts.month,
          parts.day,
          parts.hour,
          parts.minute
        );
      }
    }
  }
  return {
    title: input.title,
    summary: input.summary,
    items,
    meals,
    datetime,
    sourceText: input.sourceText,
  };
}
