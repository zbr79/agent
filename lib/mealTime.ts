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

const pad = (n: number) => String(n).padStart(2, "0");

// Flexible parsing for the confirm modal's native date/time pickers.
// Accepts the chat's formats: "2026年9月3日 下午 6:17", "2026-08-26 18:17",
// "8/26/2026 6:17 PM", or time-only ("下午 6:17" → today's date).
export function parseFlexibleDateTime(
  value: string,
  now = new Date()
): { date: string; time: string } | null {
  const text = value.trim();
  if (!text) return null;

  let rest = text;
  let date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const dateMatch =
    text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/) ??
    text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/) ??
    text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dateMatch) {
    date =
      dateMatch[3].length === 4
        ? `${dateMatch[3]}-${pad(Number(dateMatch[1]))}-${pad(Number(dateMatch[2]))}`
        : `${dateMatch[1]}-${pad(Number(dateMatch[2]))}-${pad(Number(dateMatch[3]))}`;
    rest = text.slice((dateMatch.index ?? 0) + dateMatch[0].length);
  }

  const timeMatch = rest.match(
    /(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i
  );
  if (!timeMatch) return null;
  const period = timeMatch[1] ?? "";
  let hour = Number(timeMatch[2]);
  const minute = Number(timeMatch[3]);
  const meridian = (timeMatch[4] ?? "").toLowerCase();
  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  if (!meridian && (period === "中午" || period === "下午" || period === "晚上") && hour < 12) {
    hour += 12;
  }
  if (hour > 23 || minute > 59) return null;
  return { date, time: `${pad(hour)}:${pad(minute)}` };
}

// Renders picker values back into the display format the app uses.
export function formatDateTimeDisplay(
  date: string,
  time: string,
  lang: "zh" | "en"
): string {
  if (!date || !time) return "";
  const [year, month, day] = date.split("-").map(Number);
  const [hourRaw, minute] = time.split(":").map(Number);
  if (!year || !month || !day || hourRaw === undefined || minute === undefined) {
    return "";
  }
  const hour = hourRaw % 24;
  if (lang === "zh") {
    const period = hour < 12 ? "上午" : "下午";
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${year}年${month}月${day}日 ${period} ${h12}:${pad(minute)}`;
  }
  const meridian = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${year}-${pad(month)}-${pad(day)} ${h12}:${pad(minute)} ${meridian}`;
}
