export type Locale = "en" | "zh";

export type TranslationPrimitive = string | number;

export type TranslationParams = Readonly<Record<string, TranslationPrimitive>>;

export interface I18nContextValue {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly toggleLocale: () => void;
  readonly t: (key: string, params?: TranslationParams) => string;
}
