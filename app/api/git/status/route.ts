import { getGitStatus } from "@/lib/git";
import { requireUser } from "@/lib/auth";
import { getWorkspaceDefinition } from "@/lib/workspaces";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  try {
    const rawWorkspace = new URL(req.url).searchParams.get("workspaceId") ?? "agent";
    const workspace = getWorkspaceDefinition(rawWorkspace);
    if (!workspace) return Response.json({ error: "Unknown workspace." }, { status: 400 });
    return Response.json(await getGitStatus(workspace.id));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not read git status." },
      { status: 500 }
    );
  }
}
