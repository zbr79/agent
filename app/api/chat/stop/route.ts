import { ObjectId } from "mongodb";
import { getUserFromRequest } from "@/lib/auth";
import {
  abortAgentSession,
  abortAgentTurn,
} from "@/lib/agent";
import {
  cancelPendingGuestRun,
  cancelPendingMessages,
  getAgentBinding,
  getGuestAgentBinding,
  getSessionWorkspace,
  isGuestSessionId,
} from "@/lib/db";
import { getWorkspaceDefinition, DEFAULT_WORKSPACE_ID } from "@/lib/workspaces";
import type { WorkspaceId } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await req.json();
    if (!raw || typeof raw !== "object") {
      return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    body = raw as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId || sessionId.length > 64) {
    return Response.json({ error: "Invalid session." }, { status: 400 });
  }

  const user = await getUserFromRequest(req).catch(() => null);
  const guest = isGuestSessionId(sessionId);
  if (!guest && !ObjectId.isValid(sessionId)) {
    return Response.json({ error: "Invalid session." }, { status: 400 });
  }
  if (!guest && !user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  let workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID;
  if (user && !guest) {
    const storedWorkspace = await getSessionWorkspace(user._id, sessionId);
    if (!storedWorkspace) {
      return Response.json({ error: "Session not found." }, { status: 404 });
    }
    workspaceId = storedWorkspace;
  } else {
    const requested = getWorkspaceDefinition(body.workspaceId);
    if (requested) workspaceId = requested.id;
  }

  const ownerKey = guest
    ? `g:${sessionId}`
    : `u:${user?._id ?? ""}:${sessionId}`;
  try {
    // Mark the in-memory turn first. This also covers the small window before
    // opencode has returned its session id to the request handler.
    await abortAgentTurn(ownerKey, workspaceId);

    // The binding is persisted separately, so abort it too when this request
    // lands on another Node worker/process.
    const binding = guest
      ? await getGuestAgentBinding(sessionId)
      : await getAgentBinding(user?._id ?? "", sessionId);
    await abortAgentSession(binding?.sessionId, workspaceId);

    const canceled = guest
      ? Number(await cancelPendingGuestRun(sessionId))
      : await cancelPendingMessages(user?._id ?? "", sessionId);
    return Response.json({ ok: true, canceled });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not stop the run.";
    return Response.json({ error: message }, { status: 502 });
  }
}
