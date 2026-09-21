import { requireUser } from "@/lib/auth";
import { getWorkspaceChanges } from "@/lib/changes";
import { workspaceRoot } from "@/lib/workspaces";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  try {
    const workspace = new URL(req.url).searchParams.get("workspace") || "agent";
    const changes = await getWorkspaceChanges(workspaceRoot(workspace));
    return Response.json(changes, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[changes] failed", error);
    return Response.json({ error: "Could not read workspace changes." }, { status: 500 });
  }
}
