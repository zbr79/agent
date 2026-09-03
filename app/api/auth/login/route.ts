import { authCookie, issueToken, verifyLogin } from "@/lib/auth";

export const runtime = "nodejs";

function errorResponse(error: string, errorCode: string, status: number) {
  return Response.json({ error, errorCode }, { status });
}

export async function POST(req: Request) {
  let username: string;
  let password: string;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      return errorResponse("Request body must be a JSON object.", "invalidBody", 400);
    }
    const { username: rawUser, password: rawPass } = body as Record<string, unknown>;
    if (typeof rawUser !== "string" || !rawUser.trim()) {
      return errorResponse('"username" must be a non-empty string.', "usernameRequired", 400);
    }
    if (typeof rawPass !== "string" || !rawPass) {
      return errorResponse('"password" must be a non-empty string.', "passwordRequired", 400);
    }
    username = rawUser;
    password = rawPass;
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Invalid request body.",
      "invalidBody",
      400
    );
  }

  try {
    const user = await verifyLogin(username, password);
    if (!user || !user._id) {
      return errorResponse("Wrong username or password.", "invalidCredentials", 401);
    }
    const token = await issueToken(user._id.toString());
    return Response.json(
      { user: { username: user.username } },
      { headers: { "Set-Cookie": authCookie(token) } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sign in.";
    return errorResponse(message, "server", 500);
  }
}
