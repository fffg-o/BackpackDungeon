"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { dictionaries } from "./dictionaries";
import type { I18nContextValue, Locale, TranslationParams } from "./types";

const STORAGE_KEY = "packrun:locale";
const DEFAULT_LOCALE: Locale = "en";

export const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocaleState(resolveBrowserLocale());
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    }
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, nextLocale);
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "en" ? "zh" : "en");
  }, [locale, setLocale]);

  const t = useCallback(
    (key: string, params?: TranslationParams) => {
      const value = lookupTranslation(dictionaries[locale], key);
      const fallback =
        typeof value === "string"
          ? value
          : lookupTranslation(dictionaries[DEFAULT_LOCALE], key);
      return interpolate(typeof fallback === "string" ? fallback : key, params);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      toggleLocale,
    }),
    [locale, setLocale, t, toggleLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function resolveBrowserLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh") return stored;

  const language = window.navigator.language.toLowerCase();
  if (
    language === "zh" ||
    language.startsWith("zh-cn") ||
    language.startsWith("zh-tw") ||
    language.startsWith("zh-hk")
  ) {
    return "zh";
  }

  return DEFAULT_LOCALE;
}

function lookupTranslation(source: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
