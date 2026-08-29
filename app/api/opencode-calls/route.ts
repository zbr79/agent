import { getOpenCodeUsage } from "@/lib/db";
import { getOpenCodeOfficialUsage } from "@/lib/opencode";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [usage, official] = await Promise.all([
      getOpenCodeUsage(),
      getOpenCodeOfficialUsage(),
    ]);
    return Response.json(
      { ...usage, official },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load OpenCode usage.";
    return Response.json({ error: message }, { status: 500 });
  }
}
