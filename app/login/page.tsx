import { redirect } from "next/navigation";

// Login is a modal now (opened from the sidebar guest footer). Old deep
// links to /login land on the home page with ?auth=1, which auto-opens the
// auth modal.
export default function LoginPage() {
  redirect("/?auth=1");
}