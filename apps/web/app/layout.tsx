import type { Metadata } from "next";
import Link from "next/link";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { Providers } from "./providers";

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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
