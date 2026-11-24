import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Miles Apart, Still Us",
  description: "A shared little world for two — notes, memories and games, wherever you are.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
