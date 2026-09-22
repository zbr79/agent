// Removed: the conclude API belonged to the legacy insulin/preset recording
// pipeline. Kept as a 410 stub so stale clients get a clear answer instead of
// a Next build error about a route without handlers.
export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  return Response.json(
    { error: "The conclude endpoint was removed (free chat mode only)." },
    { status: 410 }
  );
}

export async function GET(): Promise<Response> {
  return POST();
}
