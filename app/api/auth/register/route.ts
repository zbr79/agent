import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_PATTERN,
  authCookie,
  createUser,
  issueToken,
} from "@/lib/auth";

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
    if (typeof rawUser !== "string" || !USERNAME_PATTERN.test(rawUser)) {
      throw new Error(
        "Username must be 3-32 characters: letters, numbers, underscores."
      );
    }
    if (
      typeof rawPass !== "string" ||
      rawPass.length < PASSWORD_MIN ||
      rawPass.length > PASSWORD_MAX
    ) {
      throw new Error(`Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`);
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
    const user = await createUser(username, password);
    if (!user || !user._id) {
      return Response.json({ error: "Username is already taken." }, { status: 409 });
    }
    const token = await issueToken(user._id.toString());
    return Response.json(
      { user: { username: user.username } },
      { status: 201, headers: { "Set-Cookie": authCookie(token) } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create the account.";
    return Response.json({ error: message }, { status: 500 });
  }
}
