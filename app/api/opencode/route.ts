// Removed: the OpenCode chat window (components/OpenCodeChat) was redundant
// with the main ChatApp, which already runs the local opencode agent via
// /api/chat. Kept as a 410 stub so stale clients get a clear answer instead
// of a Next build error about a route without handlers.
export const runtime = "nodejs";

function gone(): Response {
  return Response.json(
    { error: "The OpenCode chat feature was removed. Use the main chat." },
    { status: 410 }
  );
}

export async function GET(): Promise<Response> {
  return gone();
}

export async function POST(): Promise<Response> {
  return gone();
}

export async function PUT(): Promise<Response> {
  return gone();
}

export async function DELETE(): Promise<Response> {
  return gone();
}
