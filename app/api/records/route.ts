import { deleteRecord, insertRecord, listRecords } from "@/lib/db";
import { translateRecord } from "@/lib/translate";
import { requireUser } from "@/lib/auth";
import type { ConcludeItem, ConcludeMeal } from "@/lib/types";

export const runtime = "nodejs";

const MAX_TITLE = 200;
const MAX_SUMMARY = 2000;
const MAX_ITEMS = 20;
const MAX_NAME = 100;
const MAX_VALUE = 500;
const MAX_SOURCE = 16000;

function parseItems(raw: unknown): ConcludeItem[] {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) {
    throw new Error(`"items" must be an array with at most ${MAX_ITEMS} entries.`);
  }
  return raw.map((item, index): ConcludeItem => {
    if (!item || typeof item !== "object") {
      throw new Error(`items[${index}] is invalid.`);
    }
    const { name, value, unit } = item as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME) {
      throw new Error(`items[${index}].name must be a short non-empty string.`);
    }
    const clean: ConcludeItem = { name };
    if (value !== undefined) {
      if (typeof value !== "string" || value.length > MAX_VALUE) {
        throw new Error(`items[${index}].value is invalid.`);
      }
      if (value) clean.value = value;
    }
    if (unit !== undefined) {
      if (typeof unit !== "string" || unit.length > MAX_VALUE) {
        throw new Error(`items[${index}].unit is invalid.`);
      }
      if (unit) clean.unit = unit;
    }
    return clean;
  });
}

function parseMeals(raw: unknown): ConcludeMeal[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) {
    throw new Error(`"meals" must be an array with at most ${MAX_ITEMS} entries.`);
  }
  return raw.map((meal, index): ConcludeMeal => {
    if (!meal || typeof meal !== "object") {
      throw new Error(`meals[${index}] is invalid.`);
    }
    const { name, foods, time } = meal as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME) {
      throw new Error(`meals[${index}].name must be a short non-empty string.`);
    }
    const clean: ConcludeMeal = { name };
    if (foods !== undefined) {
      if (typeof foods !== "string" || foods.length > MAX_VALUE) {
        throw new Error(`meals[${index}].foods is invalid.`);
      }
      if (foods) clean.foods = foods;
    }
    if (time !== undefined) {
      if (typeof time !== "string" || time.length > MAX_VALUE) {
        throw new Error(`meals[${index}].time is invalid.`);
      }
      if (time) clean.time = time;
    }
    return clean;
  });
}

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  try {
    const records = await listRecords(auth._id, 100);
    return Response.json({ records });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load records.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let title: string;
  let summary: string;
  let items: ConcludeItem[];
  let meals: ConcludeMeal[] | undefined;
  let sourceText: string | undefined;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      throw new Error("Request body must be a JSON object.");
    }
    const {
      title: rawTitle,
      summary: rawSummary,
      items: rawItems,
      meals: rawMeals,
      sourceText: rawSource,
    } = body as Record<string, unknown>;
    if (typeof rawTitle !== "string" || !rawTitle.trim() || rawTitle.length > MAX_TITLE) {
      throw new Error('"title" must be a short non-empty string.');
    }
    title = rawTitle;
    if (typeof rawSummary !== "string" || rawSummary.length > MAX_SUMMARY) {
      throw new Error('"summary" is invalid.');
    }
    summary = rawSummary;
    items = parseItems(rawItems);
    meals = parseMeals(rawMeals);
    if (rawSource !== undefined) {
      if (typeof rawSource !== "string" || rawSource.length > MAX_SOURCE) {
        throw new Error('"sourceText" is invalid.');
      }
      sourceText = rawSource;
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request body." },
      { status: 400 }
    );
  }

  try {
    const translated = translateRecord({ title, summary, items, meals, sourceText });
    const record = await insertRecord(auth._id, translated);
    return Response.json({ record }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save the record.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return Response.json({ error: '"id" query parameter is required.' }, { status: 400 });
  }
  try {
    const deleted = await deleteRecord(auth._id, id);
    if (!deleted) {
      return Response.json({ error: "Record not found." }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not delete the record.";
    return Response.json({ error: message }, { status: 500 });
  }
}
