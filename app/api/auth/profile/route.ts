import { requireUser, DISPLAY_NAME_MAX } from "@/lib/auth";
import { updateUserDisplayName } from "@/lib/accounts";

export const runtime = "nodejs";

function errorResponse(error: string, errorCode: string, status: number, extra = {}) {
  return Response.json({ error, errorCode, ...extra }, { status });
}

export async function PATCH(req: Request) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  let displayName: unknown;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      return errorResponse("Request body must be a JSON object.", "invalidBody", 400);
    }
    ({ displayName } = body as Record<string, unknown>);
  } catch {
    return errorResponse("Invalid request body.", "invalidBody", 400);
  }

  if (typeof displayName !== "string" || !displayName.trim()) {
    return errorResponse("Display name is required.", "displayNameRequired", 400);
  }
  const normalized = displayName.trim();
  if (normalized.length > DISPLAY_NAME_MAX) {
    return errorResponse("Display name is too long.", "displayNameLength", 400, {
      max: DISPLAY_NAME_MAX,
    });
  }

  try {
    const updated = await updateUserDisplayName(user._id, normalized);
    if (!updated) {
      return errorResponse("Could not update the display name.", "server", 500);
    }
    return Response.json({
      user: {
        ...user,
        displayName: normalized,
      },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Could not update the display name.",
      "server",
      500
    );
  }
}
