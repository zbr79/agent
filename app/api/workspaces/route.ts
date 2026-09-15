import { getUserFromRequest } from "@/lib/auth";
import { getWorkspaceOrder } from "@/lib/db";
import { listWorkspaceInfo } from "@/lib/workspaces";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  const order = user ? await getWorkspaceOrder(user._id) : [];
  return Response.json({
    workspaces: listWorkspaceInfo(false, order),
  });
}
