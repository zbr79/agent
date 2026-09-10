// One-time title backfill (pass 2, ran 2026-09-09) — retired. Delete file.
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ error: "This one-time job is retired." }, { status: 410 });
}
