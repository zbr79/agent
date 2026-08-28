import { Suspense } from "react";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "InsChat — Insulin & Glucose Tracker",
  description: "Record insulin levels with timestamps and food photos. Get AI-powered analysis for diabetes management.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
