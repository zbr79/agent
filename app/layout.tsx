import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GemChat — AI Chat with Images",
  description: "A minimalist chatbot powered by the Google Gemini API. Text chat and image upload, streaming responses.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
