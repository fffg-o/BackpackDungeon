import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "BackpackDungeon",
  description: "Packrun foundation"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="navLink">
            🏠 Home
          </Link>
          <Link href="/dungeon" className="navLink">
            🗺️ Daily Dungeon
          </Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
