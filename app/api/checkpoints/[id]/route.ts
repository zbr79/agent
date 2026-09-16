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
  const preview = await getCheckpointPreview(auth._id, id);
  if (!preview) {
    return Response.json({ error: "Checkpoint not found." }, { status: 404 });
  }
  return Response.json(preview);
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const deleted = await deleteCheckpoint(auth._id, id);
  if (!deleted) {
    return Response.json({ error: "Checkpoint not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
