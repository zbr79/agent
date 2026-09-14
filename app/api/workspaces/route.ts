import { listWorkspaceInfo } from "@/lib/workspaces";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    workspaces: listWorkspaceInfo(false),
  });
}
