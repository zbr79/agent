import { requireUser } from "@/lib/auth";
import { listCheckpoints } from "@/lib/checkpoints";
import type { WorkspaceId } from "@/lib/types";
import { getWorkspaceDefinition } from "@/lib/workspaces";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const workspace = getWorkspaceDefinition(
    new URL(req.url).searchParams.get("workspace")
  );
  if (!workspace) {
    return Response.json({ error: "Invalid workspace." }, { status: 400 });
  }
  const checkpoints = await listCheckpoints(auth._id, workspace.id as WorkspaceId);
  return Response.json({ checkpoints });
}
