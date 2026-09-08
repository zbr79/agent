import { redirect } from "next/navigation";

// Removed: the records page belonged to the old meal-log feature. Stale
// bookmarks redirect home instead of 404ing.
export default function RecordsPage() {
  redirect("/");
}
