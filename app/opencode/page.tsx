import { redirect } from "next/navigation";

// Removed: the OpenCode chat was a redundant second chat window (see
// components/OpenCodeChat). Stale bookmarks redirect home.
export default function OpenCodePage() {
  redirect("/");
}
