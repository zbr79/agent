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

const MEAL_TIME_NAMES: Record<string, [string, string, string, string, string]> = {
  zh: ["早餐", "午餐", "下午茶", "晚餐", "夜宵"],
  en: ["Breakfast", "Lunch", "Afternoon snack", "Dinner", "Late-night snack"],
};

// Refines a generic snack name (加餐/Snack) into the time-based meal name.
// Returns the original name when it is not a generic snack, or when the time
// cannot be parsed.
export function refineMealName(
  name: string,
  time: string | undefined,
  lang: "zh" | "en"
): string {
  const clean = name.trim();
  const generic =
    lang === "zh" ? clean === "加餐" : /^(snack|snacks)$/i.test(clean);
  if (!generic) return clean;
  const parsed = parseFlexibleDateTime(time ?? "");
  if (!parsed) return clean;
  const hour = Number(parsed.time.split(":")[0]);
  const [b, l, t, d, n] = MEAL_TIME_NAMES[lang];
  if (hour >= 5 && hour < 11) return b;
  if (hour >= 11 && hour < 15) return l;
  if (hour >= 15 && hour < 17) return t;
  if (hour >= 17 && hour < 21) return d;
  return n;
}

export const READING_PHASES: Record<
  string,
  [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string
  ]
> = {
  // fasting | before breakfast | after breakfast | before lunch | after lunch
  // | afternoon | before dinner | after dinner | bedtime | late night
  zh: ["空腹", "早餐前", "早餐后", "午餐前", "午餐后", "下午", "晚餐前", "晚餐后", "睡前", "凌晨"],
  en: [
    "Fasting",
    "Before breakfast",
    "After breakfast",
    "Before lunch",
    "After lunch",
    "Afternoon",
    "Before dinner",
    "After dinner",
    "Bedtime",
    "Late night",
  ],
};

// Readings are conventionally logged against a day slot, not a bare
// number: 空腹 / 早餐后 / 午餐前 ... / 睡前 (fasting, pre/post meal, bedtime).
// Derives that phase label from the entry time. Returns "" when the time
// cannot be parsed. Applies to glucose and insulin readings alike.
export function readingPhase(
  time: string | undefined,
  lang: "zh" | "en"
): string {
  const parsed = parseFlexibleDateTime(time ?? "");
  if (!parsed) return "";
  const hour = Number(parsed.time.split(":")[0]);
  const [f, , ab, bl, al, af, bd, ad, bt, ln] = READING_PHASES[lang];
  if (hour >= 5 && hour < 9) return f; // 05:00–08:59 fasting
  if (hour >= 9 && hour < 11) return ab; // 09:00–10:59 after breakfast
  if (hour >= 11 && hour < 12) return bl; // 11:00–11:59 before lunch
  if (hour >= 12 && hour < 14) return al; // 12:00–13:59 after lunch
  if (hour >= 14 && hour < 17) return af; // 14:00–16:59 afternoon
  if (hour >= 17 && hour < 18) return bd; // 17:00–17:59 before dinner
  if (hour >= 18 && hour < 21) return ad; // 18:00–20:59 after dinner
  if (hour >= 21 && hour < 24) return bt; // 21:00–23:59 bedtime
  return ln; // 00:00–04:59 late night
}

// Refines a bare insulin entry name (胰岛素/Insulin) into "胰岛素 空腹" /
// "Insulin Fasting" style by time. Returns the original name when it is not
// a bare insulin entry, or when the time cannot be parsed.
export function refineInsulinName(
  name: string,
  time: string | undefined,
  lang: "zh" | "en"
): string {
  const clean = name.trim();
  const bare =
    lang === "zh" ? clean === "胰岛素" : /^insulin$/i.test(clean);
  if (!bare) return clean;
  const phase = readingPhase(time, lang);
  if (!phase) return clean;
  return lang === "zh" ? `胰岛素 ${phase}` : `Insulin ${phase}`;
}

export interface PairedItem {
  item: { name: string; value?: string; unit?: string };
  time: string | undefined;
  // Stored phase selection (时段/phase item), when the user overrode the
  // time-derived label. Undefined = derive from time at display.
  phase: string | undefined;
}

// Conclusion items store each reading followed by its own 时间/time item
// (血糖 → 时间, 胰岛素 → 时间), and optionally a 时段/phase item after the time
// when the phase was chosen manually. Re-attaches every reading to its time
// and phase so displays can show the date and label together. Time/phase
// items that precede a reading (orphans) are dropped.
export function pairTimeItems(
  items: { name: string; value?: string; unit?: string }[]
): PairedItem[] {
  const paired: PairedItem[] = [];
  let pending: PairedItem | null = null;
  for (const item of items) {
    const name = item.name.trim();
    if (/^(时间|time|timestamp|date|when)$/i.test(name)) {
      if (pending) {
        pending.time = item.value ?? "";
        paired.push(pending);
        pending = null;
      }
    } else if (/^(时段|phase)$/i.test(name) && pending) {
      pending.phase = item.value ?? "";
    } else {
      if (pending) paired.push(pending);
      pending = { item, time: undefined, phase: undefined };
    }
  }
  if (pending) paired.push(pending);
  return paired;
}
