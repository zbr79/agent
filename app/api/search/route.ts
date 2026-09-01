import { searchChats, searchRecords } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const scope = url.searchParams.get("scope") ?? "all";
  if (!q || q.length > 200) {
    return Response.json({ error: '"q" must be a non-empty string.' }, { status: 400 });
  }
  if (!["all", "chats", "records"].includes(scope)) {
    return Response.json({ error: '"scope" must be all|chats|records.' }, { status: 400 });
  }

  try {
    const wantChats = scope === "all" || scope === "chats";
    const wantRecords = scope === "all" || scope === "records";
    const [chats, records] = await Promise.all([
      wantChats ? searchChats(auth._id, q) : Promise.resolve([]),
      wantRecords ? searchRecords(auth._id, q) : Promise.resolve([]),
    ]);
    return Response.json({ chats, records });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not search.";
    return Response.json({ error: message }, { status: 500 });
  }
}
