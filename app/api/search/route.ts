import { searchChats } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q || q.length > 200) {
    return Response.json({ error: '"q" must be a non-empty string.' }, { status: 400 });
  }

  try {
    const chats = await searchChats(auth._id, q);
    return Response.json({ chats });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not search.";
    return Response.json({ error: message }, { status: 500 });
  }
}
