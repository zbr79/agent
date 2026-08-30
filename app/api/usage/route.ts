import { CHAT_MODELS, getActiveModel } from "@/lib/models";
import { getOpenCodeUsage } from "@/lib/db";
import { getOpenCodeOfficialUsage } from "@/lib/opencode";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [usage, official] = await Promise.all([
      getOpenCodeUsage(),
      getOpenCodeOfficialUsage(),
    ]);
    const byModel = new Map(usage.models.map((row) => [row.model, row.count]));
    return Response.json(
      {
        model: getActiveModel(),
        total: usage.total,
        last5h: usage.last5h,
        last7d: usage.last7d,
        last30d: usage.last30d,
        failed30d: usage.failed30d,
        official,
        models: CHAT_MODELS.map((model) => ({
          name: model.name,
          label: model.label,
          tier: model.tier,
          vision: model.vision,
          retired: Boolean(model.retired),
          used: byModel.get(model.name) ?? 0,
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load usage.";
    return Response.json({ error: message }, { status: 500 });
  }
}
