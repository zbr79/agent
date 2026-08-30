import { getShare } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const share = await getShare(token);
    if (!share) {
      return Response.json({ error: "Share not found." }, { status: 404 });
    }
    return Response.json(share, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load the share.";
    return Response.json({ error: message }, { status: 500 });
  }
}
