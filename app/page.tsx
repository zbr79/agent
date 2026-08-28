import { Suspense } from "react";
import ChatApp from "@/components/ChatApp";

export default function Home() {
  return (
    <Suspense>
      <ChatApp />
    </Suspense>
  );
}
