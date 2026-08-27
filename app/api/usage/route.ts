import { getUsage } from "@/lib/usage";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(getUsage(), {
    headers: { "Cache-Control": "no-store" },
  });
}
