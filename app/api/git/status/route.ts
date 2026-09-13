import { getGitStatus } from "@/lib/git";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await getGitStatus());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not read git status." },
      { status: 500 }
    );
  }
}
