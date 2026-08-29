import { Suspense } from "react";
import OpenCodeCallsPanel from "@/components/OpenCodeCallsPanel";

export default function OpenCodeCallsPage() {
  return (
    <Suspense>
      <OpenCodeCallsPanel />
    </Suspense>
  );
}
