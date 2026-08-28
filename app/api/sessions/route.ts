import { insertSession, listSessions } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_TITLE = 120;

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  try {
    const sessions = await listSessions(auth._id, 50);
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
  try {
    const body: unknown = await req.json();
    const rawTitle =
      body && typeof body === "object"
        ? (body as { title?: unknown }).title
        : undefined;
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
    const session = await insertSession(auth._id, title);
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create the session.";
    return Response.json({ error: message }, { status: 500 });
  }
}
