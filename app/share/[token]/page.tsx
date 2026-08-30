import { getShare } from "@/lib/db";
import ShareViewer from "@/components/ShareViewer";

export const runtime = "nodejs";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let share = null;
  try {
    share = await getShare(token);
  } catch {}
  return <ShareViewer share={share} />;
}
