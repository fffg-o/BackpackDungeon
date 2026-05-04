"use client";

import Link from "next/link";
import { useI18n } from "./useI18n";

export function LanguageToggle() {
  const { locale, t, toggleLocale } = useI18n();

  return (
    <button type="button" className="languageToggle" onClick={toggleLocale}>
      {locale === "en" ? t("language.switchToChinese") : t("language.switchToEnglish")}
    </button>
  );
}

export function LocalizedNavLinks() {
  const { t } = useI18n();

  return (
    <>
      <Link href="/" className="navLink">
        {t("nav.home")}
      </Link>
      <Link href="/dungeon" className="navLink">
        {t("nav.dungeon")}
      </Link>
    </>
  );
}
