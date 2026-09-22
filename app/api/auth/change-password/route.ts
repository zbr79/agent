import { changeUserPassword, PASSWORD_MAX, PASSWORD_MIN, requireUser } from "@/lib/auth";

export const runtime = "nodejs";

function errorResponse(error: string, errorCode: string, status: number, extra = {}) {
  return Response.json({ error, errorCode, ...extra }, { status });
}

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  let currentPassword: unknown;
  let newPassword: unknown;
  let confirmPassword: unknown;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      return errorResponse("Request body must be a JSON object.", "invalidBody", 400);
    }
    ({ currentPassword, newPassword, confirmPassword } = body as Record<string, unknown>);
  } catch {
    return errorResponse("Invalid request body.", "invalidBody", 400);
  }

  if (typeof currentPassword !== "string" || !currentPassword) {
    return errorResponse("Current password is required.", "currentPasswordRequired", 400);
  }
  if (typeof newPassword !== "string" || !newPassword) {
    return errorResponse("New password is required.", "passwordRequired", 400);
  }
  if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
    return errorResponse("Password length is invalid.", "passwordLength", 400, {
      min: PASSWORD_MIN,
      max: PASSWORD_MAX,
    });
  }
  if (newPassword !== confirmPassword) {
    return errorResponse("New passwords do not match.", "passwordMismatch", 400);
  }

  try {
    const changed = await changeUserPassword(user._id, currentPassword, newPassword);
    if (!changed) {
      return errorResponse("The current password is incorrect.", "invalidCurrentPassword", 401);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Could not change the password.",
      "server",
      500
    );
  }
}
