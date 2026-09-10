// Temp /api/title debug probe — retired. Delete file.
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ error: "This probe is retired." }, { status: 410 });
}
