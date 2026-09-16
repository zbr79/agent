import { requireUser } from "@/lib/auth";
import {
  getRestoreConflictPreview,
  restoreCheckpoint,
} from "@/lib/checkpoints";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  try {
    const preview = await getRestoreConflictPreview(auth._id, id);
    if (!preview) {
      return Response.json({ error: "Checkpoint not found." }, { status: 404 });
    }
    if (preview.conflicts.length) {
      return Response.json(
        { error: "Checkpoint has conflicts.", ...preview },
        { status: 409 }
      );
    }
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {}
    if (
      !body ||
      typeof body !== "object" ||
      (body as { confirm?: unknown }).confirm !== true
    ) {
      return Response.json(
        { error: "Explicit restore confirmation is required.", ...preview },
        { status: 400 }
      );
    }
    const restored = await restoreCheckpoint(auth._id, id);
    if (!restored) {
      return Response.json({ error: "Checkpoint could not be restored." }, { status: 409 });
    }
    if (restored.preview.conflicts.length) {
      return Response.json(
        { error: "Checkpoint changed while restoring.", ...restored.preview },
        { status: 409 }
      );
    }
    return Response.json({ ok: true, ...restored });
  } catch (error) {
    console.error("[checkpoints] restore failed", error);
    const detail = error instanceof Error ? error.message.slice(0, 240) : "unknown error";
    return Response.json(
      {
        error: "Checkpoint restore failed. Please try again.",
        detail,
      },
      { status: 503 }
    );
  }
}
