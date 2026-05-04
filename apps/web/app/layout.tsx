import type { Metadata } from "next";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { I18nProvider } from "./i18n/I18nProvider";
import { LanguageToggle, LocalizedNavLinks } from "./i18n/LanguageToggle";
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
        <I18nProvider>
          <nav className="nav">
            <LocalizedNavLinks />
            <LanguageToggle />
          </nav>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
