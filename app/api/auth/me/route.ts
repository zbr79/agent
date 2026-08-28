import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return Response.json({ error: "Not signed in." }, { status: 401 });
    }
    return Response.json({ user });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not check the session.";
    return Response.json({ error: message }, { status: 500 });
  }
}
