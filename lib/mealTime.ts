// Parses the Chinese meal-time format the chat produces, e.g.
// "2026年8月26日 下午 6:17" → parts + a display label + an epoch hint.
// Pure function, safe to import on the client.

export interface MealTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateKey: string; // YYYY-MM-DD
  timeLabel: string; // e.g. "下午 6:17"
  tsLocal: number; // epoch ms interpreted in the local timezone
}

const CHINESE_TIME =
  /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2}):(\d{2})/;

export function parseMealDateTime(value: string): MealTimeParts | null {
  const match = CHINESE_TIME.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const period = match[4] ?? "";
  const h = Number(match[5]);
  const minute = Number(match[6]);
  const needsShift =
    (period === "中午" || period === "下午" || period === "晚上") && h < 12;
  const hour = needsShift ? h + 12 : h;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    year,
    month,
    day,
    hour,
    minute,
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
    timeLabel: period ? `${period} ${h}:${minute}` : `${h}:${minute}`,
    tsLocal: new Date(year, month - 1, day, hour, minute).getTime(),
  };
}
