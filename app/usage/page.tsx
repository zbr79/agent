import type { Metadata } from "next";
import UsagePanel from "@/components/UsagePanel";

export const metadata: Metadata = {
  title: "API Usage — Agent",
};

export default function UsagePage() {
  return <UsagePanel />;
}
