import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SpecDrawing — Material Presenter",
  description:
    "Place building materials and fixtures onto a base perspective image and present.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
