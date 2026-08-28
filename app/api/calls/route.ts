import { countCalls, listCalls } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  try {
    const [calls, counts] = await Promise.all([listCalls(100), countCalls()]);
    return Response.json({ calls, total: counts.total, failed: counts.failed });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load API calls.";
    return Response.json({ error: message }, { status: 500 });
  }
}
