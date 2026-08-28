import { CHAT_MODELS, getActiveModel, getConcludeChain, setActiveModel } from "@/lib/models";
import { GEMINI_LIMITS, getModelExhaustedAt, getModelUsage } from "@/lib/usage";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const current = getActiveModel();
  return Response.json({
    current,
    concludeModel: getConcludeChain()[0] ?? null,
    limit: GEMINI_LIMITS.rpd,
    models: CHAT_MODELS.map((model) => ({
      name: model.name,
      label: model.label,
      tier: model.tier,
      vision: model.vision,
      retired: Boolean(model.retired),
      used: getModelUsage(model.name),
      exhaustedByApi: getModelExhaustedAt(model.name) !== null,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let model: string;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    const { model: rawModel } = body as { model?: unknown };
    if (typeof rawModel !== "string" || !rawModel) {
      return Response.json({ error: '"model" must be a non-empty string.' }, { status: 400 });
    }
    model = rawModel;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    setActiveModel(model);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Cannot switch to this model." },
      { status: 400 }
    );
  }

  return GET(req);
}
