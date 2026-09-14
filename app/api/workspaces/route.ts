import { getUserFromRequest } from "@/lib/auth";
import { listWorkspaceInfo } from "@/lib/workspaces";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  return Response.json({
    workspaces: listWorkspaceInfo(!user),
  });
}
