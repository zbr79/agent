import { getHealthReport } from "@/lib/health";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    const report = await getHealthReport(force);
    return Response.json(report);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Health check failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
