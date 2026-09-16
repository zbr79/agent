import { requireUser } from "@/lib/auth";
import {
  deleteCheckpoint,
  getCheckpointPreview,
} from "@/lib/checkpoints";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  try {
    const preview = await getCheckpointPreview(auth._id, id);
    if (!preview) {
      return Response.json({ error: "Checkpoint not found." }, { status: 404 });
    }
    return Response.json(preview);
  } catch (error) {
    console.error("[checkpoints] preview failed", error);
    return Response.json(
      { error: "Checkpoint storage is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  try {
    const deleted = await deleteCheckpoint(auth._id, id);
    if (!deleted) {
      return Response.json({ error: "Checkpoint not found." }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[checkpoints] delete failed", error);
    return Response.json(
      { error: "Checkpoint storage is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
