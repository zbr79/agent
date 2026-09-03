import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_PATTERN,
  authCookie,
  createUser,
  issueToken,
} from "@/lib/auth";

export const runtime = "nodejs";

function errorResponse(
  error: string,
  errorCode: string,
  status: number,
  extra?: Record<string, number>
) {
  return Response.json({ error, errorCode, ...extra }, { status });
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
    if (typeof rawUser !== "string" || !USERNAME_PATTERN.test(rawUser)) {
      return errorResponse(
        "Username must be 3-32 characters: letters, numbers, underscores.",
        "usernameInvalid",
        400
      );
    }
    if (
      typeof rawPass !== "string" ||
      rawPass.length < PASSWORD_MIN ||
      rawPass.length > PASSWORD_MAX
    ) {
      return errorResponse(
        `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`,
        "passwordLength",
        400,
        { min: PASSWORD_MIN, max: PASSWORD_MAX }
      );
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
    const user = await createUser(username, password);
    if (!user || !user._id) {
      return errorResponse("Username is already taken.", "usernameTaken", 409);
    }
    const token = await issueToken(user._id.toString());
    return Response.json(
      { user: { username: user.username } },
      { status: 201, headers: { "Set-Cookie": authCookie(token) } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create the account.";
    return errorResponse(message, "server", 500);
  }
}
