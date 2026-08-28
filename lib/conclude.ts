import { GoogleGenAI, type Content } from "@google/genai";
import {
  ChatValidationError,
  getApiKey,
  isOverloadedError,
  isQuotaError,
  isUnavailableError,
} from "./gemini";
import { getConcludeChain } from "./models";
import { recordError, recordQuotaExhausted, recordRequest } from "./usage";
import { insertCall } from "./db";
import type { ConcludeResult } from "./types";

const CONCLUDE_PROMPT = `You turn a chat assistant's reply into a compact structured conclusion.

Given:
1. The assistant's reply (free text).
2. The user's message that prompted it (for context such as time of day, meal timing, or the question asked).

Produce a JSON conclusion with:
- "title": a very short label, e.g. "Insulin reading", "Meal analysis", "Weight check".
- "summary": one short sentence restating the key facts.
- "items": the extracted data points as a list. Each item has:
  - "name": the metric or thing measured/described (e.g. "insulin", "blood glucose", "foods", "calories").
  - "value": the value as a short string (e.g. "130", "rice, chicken, broccoli"). Only when there is a concrete value.
  - "unit": the unit if stated or clearly implied (e.g. "mg/dL", "kg", "g"). Only when applicable.
- "meals": an array with one entry PER MEAL described in the reply. Each entry has:
  - "name": the meal name (早餐/午餐/晚餐/加餐, or breakfast/lunch/dinner/snack).
  - "foods": the meal's foods as a comma-separated string.
  - "time": the meal's time when stated (e.g. "2026年8月26日 下午 6:17").
  Empty array when the reply describes no meals.

Rules:
- Extract only what is actually stated in the reply. Never invent numbers or facts.
- "value" must contain ONLY the extracted value (e.g. "130", "rice, chicken, broccoli"). Never put commentary, reasoning, questions, or alternative readings inside it.
- One item per metric. Do not repeat the same metric in multiple items.
- N meals in the reply = N "meals" entries — never split one meal into multiple entries, never merge two meals into one entry. Each meal's foods and time must stay attached to that meal.
- If the reply contains no concrete data to record, return an empty "items" array and a summary that says so.
- If a time or time-of-day appears (e.g. "7 am", "morning"), include it as its own item named "time".`;

const LANG_CHINESE = `LANGUAGE RULE: The source reply is Chinese, so the ENTIRE conclusion must be in Chinese — "title", "summary", and every item "name" in Chinese (e.g. "早餐", "胰岛素", "血糖", "体重"). The item named for time must be "时间". Keep "unit" exactly as stated (e.g. "mg/dL"). No English words in title, summary, or item names.`;

const LANG_ENGLISH = `LANGUAGE RULE: The source reply is English, so the ENTIRE conclusion must be in English — "title", "summary", and every item "name" in English. The item named for time must be "time". Keep "unit" exactly as stated (e.g. "mg/dL"). No other languages in title, summary, or item names.`;

function detectLanguage(text: string): "chinese" | "english" {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const nonSpace = text.replace(/\s/g, "").length;
  return cjk > 0 && cjk >= nonSpace / 4 ? "chinese" : "english";
}

const CONCLUDE_SCHEMA = {
  type: "object",
  description: "Structured conclusion extracted from an assistant reply.",
  properties: {
    title: {
      type: "string",
      description: "Short label for the conclusion, e.g. 'Insulin reading'.",
    },
    summary: {
      type: "string",
      description: "One short sentence with the key facts.",
    },
    items: {
      type: "array",
      description: "Extracted data points. Empty when nothing concrete exists.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Metric or thing measured." },
          value: {
            type: "string",
            description: "Only the extracted value, e.g. '130' or 'rice, chicken, broccoli'. No commentary.",
          },
          unit: {
            type: "string",
            description: "Unit, when stated or implied, e.g. 'mg/dL'.",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    meals: {
      type: "array",
      description: "One entry per meal described in the reply. Empty when no meals.",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Meal name: 早餐/午餐/晚餐/加餐 or breakfast/lunch/dinner/snack.",
          },
          foods: {
            type: "string",
            description: "The meal's foods as a comma-separated string.",
          },
          time: {
            type: "string",
            description: "The meal's time when stated.",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "summary", "items", "meals"],
  additionalProperties: false,
};

function toContents(text: string, context?: string): Content[] {
  const parts = [{ text: `Assistant reply:\n"""\n${text}\n"""` }];
  if (context) {
    parts.push({ text: `User message that prompted it:\n"""\n${context}\n"""` });
  }
  return [{ role: "user", parts }];
}

function sanitize(raw: unknown, language: "chinese" | "english"): ConcludeResult {
  const object = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!object) throw new Error("Conclusion response was not valid JSON.");
  const defaultTitle = language === "chinese" ? "总结" : "Conclusion";
  const defaultSummary =
    language === "chinese"
      ? "未找到可记录的具体数据。"
      : "Nothing concrete found to record.";
  const title = typeof object.title === "string" && object.title ? object.title : defaultTitle;
  const summary =
    typeof object.summary === "string" && object.summary
      ? object.summary
      : defaultSummary;
  const rawItems = Array.isArray(object.items) ? object.items : [];
  const items = rawItems
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const { name, value, unit } = item as Record<string, unknown>;
      const clean: { name: string; value?: string; unit?: string } = {
        name: typeof name === "string" && name ? name : "item",
      };
      if (typeof value === "string" && value) clean.value = value;
      if (typeof unit === "string" && unit) clean.unit = unit;
      return clean;
    })
    .slice(0, 20);
  const rawMeals = Array.isArray(object.meals) ? object.meals : [];
  const meals = rawMeals
    .filter((meal) => meal && typeof meal === "object")
    .map((meal) => {
      const { name, foods, time } = meal as Record<string, unknown>;
      const clean: { name: string; foods?: string; time?: string } = {
        name: typeof name === "string" && name ? name : "meal",
      };
      if (typeof foods === "string" && foods) clean.foods = foods;
      if (typeof time === "string" && time) clean.time = time;
      return clean;
    })
    .slice(0, 10);
  return { title, summary, items, meals };
}

export async function concludeMessage(
  text: string,
  context?: string
): Promise<ConcludeResult> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const contents = toContents(text, context);
  const chain = getConcludeChain();
  const language = detectLanguage(text);
  const systemInstruction = `${CONCLUDE_PROMPT}\n\n${
    language === "chinese" ? LANG_CHINESE : LANG_ENGLISH
  }`;

  let lastError: unknown = null;

  for (const model of chain) {
    let parsed: ConcludeResult | null = null;
    for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            temperature: 0.1,
            responseMimeType: "application/json",
            responseJsonSchema: CONCLUDE_SCHEMA,
          },
        });
        const raw = response.text;
        if (!raw) throw new Error("Empty conclusion response.");
        recordRequest(model);
        parsed = sanitize(JSON.parse(raw), language);
        insertCall({ kind: "conclude", model, ok: true }).catch(() => {});
      } catch (error) {
        lastError = error;
        const skip =
          isQuotaError(error) ||
          isUnavailableError(error) ||
          error instanceof SyntaxError;
        if (skip) {
          if (isQuotaError(error)) recordQuotaExhausted(model);
          insertCall({
            kind: "conclude",
            model,
            ok: false,
            error: String(
              error instanceof Error ? error.message : error
            ).slice(0, 300),
          }).catch(() => {});
          break;
        }
        if (isOverloadedError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
          continue;
        }
        if (error instanceof ChatValidationError) throw error;
        throw error;
      }
    }
    if (parsed) return parsed;
  }

  if (!(lastError instanceof ChatValidationError)) {
    recordError();
  }
  throw lastError ?? new Error("Conclude request failed: all models unavailable.");
}
