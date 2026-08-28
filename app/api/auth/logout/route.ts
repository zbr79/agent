import { clearAuthCookie, logoutRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await logoutRequest(req);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearAuthCookie() } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not sign out.";
    return Response.json({ error: message }, { status: 500 });
  }
}
