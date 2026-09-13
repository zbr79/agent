import { requireUser } from "@/lib/auth";
import { commitAndMaybePush } from "@/lib/git";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      return Response.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const { message, push } = body as { message?: unknown; push?: unknown };
    if (typeof push !== "boolean") {
      return Response.json({ error: '"push" must be a boolean.' }, { status: 400 });
    }
    return Response.json(await commitAndMaybePush(message, push));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not commit changes.";
    const status =
      /no changes|nothing to commit|denylisted|empty|too long|invalid/i.test(message)
        ? 409
        : /push/i.test(message)
          ? 409
          : 500;
    return Response.json({ error: message }, { status });
  }
}
