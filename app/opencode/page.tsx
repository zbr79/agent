import { Suspense } from "react";
import OpenCodeChat from "@/components/OpenCodeChat";

export default function OpenCodePage() {
  return (
    <Suspense>
      <OpenCodeChat />
    </Suspense>
  );
}
