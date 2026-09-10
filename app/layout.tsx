// <!-- qa-fix-20260907 -->
// <!-- qa-refresh-20260907 -->
import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import Sidebar from "@/components/Sidebar";
import { AGENT_ROOT } from "@/lib/pathJail";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent",
  description: "General-purpose AI chat with photo analysis and live web research. Previously saved records stay viewable.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Agent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="shell">
          <Suspense>
            <Sidebar workspace={AGENT_ROOT} />
          </Suspense>
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
