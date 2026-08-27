import type { Metadata } from "next";
import UsagePanel from "@/components/UsagePanel";

export const metadata: Metadata = {
  title: "API Usage — InsChat",
};

export default function UsagePage() {
  return <UsagePanel />;
}
