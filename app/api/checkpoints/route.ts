import { requireUser } from "@/lib/auth";
import { listCheckpoints } from "@/lib/checkpoints";
import type { WorkspaceId } from "@/lib/types";
import { getWorkspaceDefinition } from "@/lib/workspaces";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const params = new URL(req.url).searchParams;
  const workspace = getWorkspaceDefinition(params.get("workspace"));
  if (!workspace) {
    return Response.json({ error: "Invalid workspace." }, { status: 400 });
  }
  const messageId = params.get("messageId")?.trim() || undefined;
  try {
    const checkpoints = await listCheckpoints(
      auth._id,
      workspace.id as WorkspaceId,
      messageId
    );
    return Response.json({ checkpoints });
  } catch (error) {
    console.error("[checkpoints] list failed", error);
    return Response.json(
      { error: "Checkpoint storage is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
