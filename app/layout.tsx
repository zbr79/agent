import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "InsChat — AI Chat Assistant",
  description: "General-purpose AI chat with photo analysis and live web research. Previously saved records stay viewable.",
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
            <Sidebar />
          </Suspense>
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
