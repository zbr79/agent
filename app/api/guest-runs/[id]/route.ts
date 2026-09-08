import { getGuestRun } from "@/lib/db";

export const runtime = "nodejs";

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
