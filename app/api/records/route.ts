// Removed: the records feature (saved meal-log reports) was part of the old
// insulin/meal-tracker app, not this agent. Kept as a 410 stub so stale
// clients get a clear answer instead of a Next build error about a route
// without handlers.
export const runtime = "nodejs";

function gone(): Response {
  return Response.json(
    { error: "The records feature was removed." },
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
