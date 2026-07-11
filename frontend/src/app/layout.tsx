import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlightSearch — 機票快速搜尋",
  description: "搜尋 TPE 出發的最便宜機票，快取命中 < 1 秒",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body className="min-h-screen bg-hero-gradient bg-fixed">{children}</body>
    </html>
  );
}
