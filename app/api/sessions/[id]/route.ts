import {
  deleteSession,
  getSessionWithMessages,
  setSessionConclusion,
  setSessionPinned,
  setSessionRecordId,
  setSessionTitle,
} from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { SessionConclusion } from "@/lib/types";

export const runtime = "nodejs";

function parseConclusion(body: unknown): SessionConclusion | null {
  if (body === null) return null;
  if (!body || typeof body !== "object") {
    throw new Error('"conclusion" must be an object or null.');
  }
  const raw = (body as { conclusion?: unknown }).conclusion;
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") {
    throw new Error('"conclusion" must be an object or null.');
  }
  const { title, summary, items, sourceText } = raw as Record<string, unknown>;
  if (typeof title !== "string" || !title) {
    throw new Error('"conclusion.title" must be a non-empty string.');
  }
  if (typeof summary !== "string" || !summary) {
    throw new Error('"conclusion.summary" must be a non-empty string.');
  }
  if (!Array.isArray(items)) {
    throw new Error('"conclusion.items" must be an array.');
  }
  const cleanItems = items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`"conclusion.items[${index}]" is invalid.`);
    }
    const { name, value, unit } = item as Record<string, unknown>;
    if (typeof name !== "string" || !name) {
      throw new Error(`"conclusion.items[${index}].name" must be a string.`);
    }
    const clean: { name: string; value?: string; unit?: string } = { name };
    if (typeof value === "string" && value) clean.value = value;
    if (typeof unit === "string" && unit) clean.unit = unit;
    return clean;
  });
  const rawMeals = (raw as { meals?: unknown }).meals;
  let meals: { name: string; foods?: string; dishes?: { name: string; rank?: string }[]; time?: string }[] | undefined;
  if (rawMeals !== undefined && rawMeals !== null) {
    if (!Array.isArray(rawMeals)) {
      throw new Error('"conclusion.meals" must be an array.');
    }
    meals = rawMeals.map((meal, index) => {
      if (!meal || typeof meal !== "object") {
        throw new Error(`"conclusion.meals[${index}]" is invalid.`);
      }
      const { name, foods, dishes, time } = meal as Record<string, unknown>;
      if (typeof name !== "string" || !name) {
        throw new Error(`"conclusion.meals[${index}].name" must be a string.`);
      }
      const clean: { name: string; foods?: string; dishes?: { name: string; rank?: string }[]; time?: string } = { name };
      if (typeof foods === "string" && foods) clean.foods = foods;
      if (Array.isArray(dishes)) {
        clean.dishes = dishes
          .filter((dish) => dish && typeof dish === "object")
          .map((dish) => {
            const rawDish = dish as Record<string, unknown>;
            const cleanDish: { name: string; rank?: string } = {
              name: typeof rawDish.name === "string" ? rawDish.name : "",
            };
            if (typeof rawDish.rank === "string" && rawDish.rank) {
              cleanDish.rank = rawDish.rank;
            }
            return cleanDish;
          });
      }
      if (typeof time === "string" && time) clean.time = time;
      return clean;
    });
  }
  return {
    title,
    summary,
    items: cleanItems,
    meals,
    sourceText: typeof sourceText === "string" ? sourceText : undefined,
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  try {
    const result = await getSessionWithMessages(auth._id, id);
    if (!result) {
      return Response.json({ error: "Session not found." }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load the session.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  try {
    const body: unknown = await req.json().catch(() => undefined);
    const rawTitle = body && typeof body === "object"
      ? (body as { title?: unknown }).title
      : undefined;
    if (rawTitle !== undefined) {
      if (typeof rawTitle !== "string" || !rawTitle.trim() || rawTitle.length > 200) {
        return Response.json({ error: '"title" is invalid.' }, { status: 400 });
      }
      const ok = await setSessionTitle(auth._id, id, rawTitle.trim());
      if (!ok) {
        return Response.json({ error: "Session not found." }, { status: 404 });
      }
      return Response.json({ ok: true });
    }
    const rawPinned = body && typeof body === "object"
      ? (body as { pinned?: unknown }).pinned
      : undefined;
    if (typeof rawPinned === "boolean") {
      const ok = await setSessionPinned(auth._id, id, rawPinned);
      if (!ok) {
        return Response.json({ error: "Session not found." }, { status: 404 });
      }
      return Response.json({ ok: true });
    }
    const rawRecordId = body && typeof body === "object"
      ? (body as { recordId?: unknown }).recordId
      : undefined;
    if (rawRecordId !== undefined) {
      if (rawRecordId !== null && (typeof rawRecordId !== "string" || rawRecordId.length > 100)) {
        return Response.json({ error: '"recordId" is invalid.' }, { status: 400 });
      }
      const ok = await setSessionRecordId(auth._id, id, rawRecordId);
      if (!ok) {
        return Response.json({ error: "Session not found." }, { status: 404 });
      }
      return Response.json({ ok: true });
    }
    const conclusion = parseConclusion(body);
    const ok = await setSessionConclusion(auth._id, id, conclusion);
    if (!ok) {
      return Response.json({ error: "Session not found." }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save the conclusion.";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  try {
    const deleted = await deleteSession(auth._id, id);
    if (!deleted) {
      return Response.json({ error: "Session not found." }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not delete the session.";
    return Response.json({ error: message }, { status: 500 });
  }
}
