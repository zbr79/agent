import { getUsage } from "@/lib/usage";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  return Response.json(getUsage(), {
    headers: { "Cache-Control": "no-store" },
  });
}
