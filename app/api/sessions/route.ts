import { insertSession, listSessions } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getWorkspaceDefinition } from "@/lib/workspaces";
import type { WorkspaceId } from "@/lib/types";

export const runtime = "nodejs";

const MAX_TITLE = 120;

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  try {
    const rawWorkspace = new URL(req.url).searchParams.get("workspaceId");
    const workspace = rawWorkspace ? getWorkspaceDefinition(rawWorkspace) : null;
    if (rawWorkspace && !workspace) {
      return Response.json({ error: "Unknown workspace." }, { status: 400 });
    }
    const sessions = await listSessions(auth._id, 50, workspace?.id);
    return Response.json({ sessions });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load sessions.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let title: string;
  let workspaceId: WorkspaceId = "agent";
  try {
    const body: unknown = await req.json();
    const rawTitle =
      body && typeof body === "object"
        ? (body as { title?: unknown }).title
        : undefined;
    const rawWorkspaceId =
      body && typeof body === "object"
        ? (body as { workspaceId?: unknown }).workspaceId
        : undefined;
    if (rawWorkspaceId !== undefined) {
      const workspace = getWorkspaceDefinition(rawWorkspaceId);
      if (!workspace) {
        return Response.json({ error: '"workspaceId" is invalid.' }, { status: 400 });
      }
      workspaceId = workspace.id;
    }
    if (rawTitle === undefined) {
      title = "New chat";
    } else if (typeof rawTitle !== "string" || rawTitle.length > MAX_TITLE) {
      return Response.json(
        { error: `"title" must be a string with at most ${MAX_TITLE} characters.` },
        { status: 400 }
      );
    } else {
      title = rawTitle.trim() || "New chat";
    }
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const session = await insertSession(auth._id, title, workspaceId);
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create the session.";
    return Response.json({ error: message }, { status: 500 });
  }
}
