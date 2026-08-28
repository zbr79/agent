import { authCookie, issueToken, verifyLogin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let username: string;
  let password: string;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      throw new Error("Request body must be a JSON object.");
    }
    const { username: rawUser, password: rawPass } = body as Record<string, unknown>;
    if (typeof rawUser !== "string" || !rawUser.trim()) {
      throw new Error('"username" must be a non-empty string.');
    }
    if (typeof rawPass !== "string" || !rawPass) {
      throw new Error('"password" must be a non-empty string.');
    }
    username = rawUser;
    password = rawPass;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request body." },
      { status: 400 }
    );
  }

  try {
    const user = await verifyLogin(username, password);
    if (!user || !user._id) {
      return Response.json({ error: "Wrong username or password." }, { status: 401 });
    }
    const token = await issueToken(user._id.toString());
    return Response.json(
      { user: { username: user.username } },
      { headers: { "Set-Cookie": authCookie(token) } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not sign in.";
    return Response.json({ error: message }, { status: 500 });
  }
}
