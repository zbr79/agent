import { finalizePendingGuestRun, getGuestRun } from "@/lib/db";

export const runtime = "nodejs";

const MAX_TEXT = 100_000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const run = await getGuestRun(id);
    return Response.json({ run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the run.";
    return Response.json({ error: message }, { status: 500 });
  }
}

// Client-driven finalize: the browser saw the whole answer, so close the
// pending guest run even if the /api/chat handler died at the same moment.
// The UUID session id is the capability (same trust model as GET), and the
// write is filtered to status "pending" so it can never rewrite a completed
// or failed run.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await req.json();
    if (!raw || typeof raw !== "object") {
      return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    body = raw as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const rawText = body.text;
  if (rawText !== undefined && (typeof rawText !== "string" || rawText.length > MAX_TEXT)) {
    return Response.json({ error: '"text" must be a string within size limits.' }, { status: 400 });
  }
  const rawElapsed = body.elapsed;
  if (
    rawElapsed !== undefined &&
    (typeof rawElapsed !== "number" ||
      !Number.isFinite(rawElapsed) ||
      rawElapsed < 0 ||
      rawElapsed > 3600)
  ) {
    return Response.json({ error: '"elapsed" is invalid.' }, { status: 400 });
  }
  try {
    const finalized = await finalizePendingGuestRun(id, {
      text: typeof rawText === "string" ? rawText : undefined,
      elapsed: typeof rawElapsed === "number" ? rawElapsed : undefined,
    });
    return Response.json({ finalized });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not finalize the run.";
    return Response.json({ error: message }, { status: 500 });
  }
}
