import { requireUser } from "@/lib/auth";
import { setWorkspaceOrder } from "@/lib/db";
import { getWorkspaceDefinition } from "@/lib/workspaces";
import type { WorkspaceId } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const body: unknown = await req.json();
    const rawOrder =
      body && typeof body === "object" && Array.isArray((body as { order?: unknown }).order)
        ? (body as { order: unknown[] }).order
        : [];
    const order = Array.from(
      new Set(
        rawOrder
          .filter((id): id is string => typeof id === "string")
          .map((id) => getWorkspaceDefinition(id)?.id)
          .filter((id): id is WorkspaceId => Boolean(id))
      )
    );
    await setWorkspaceOrder(auth._id, order);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid workspace order." }, { status: 400 });
  }
}
