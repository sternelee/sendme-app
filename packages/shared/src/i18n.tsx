import { createSignal } from "solid-js";
import { flatten, resolveTemplate, translator } from "@solid-primitives/i18n";
import translations from "../../../translations.json";

export type Locale = "en" | "zh-CN";

const LOCALE_STORAGE_KEY = "sendme.locale";

type Dict = typeof translations.en;

const dictionaries = {
  en: flatten(translations.en as Dict),
  "zh-CN": flatten(translations["zh-CN"] as Dict),
};

const getStoredLocale = (): Locale => {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored === "zh-CN" ? "zh-CN" : "en";
};

const [locale, setLocaleSignal] = createSignal<Locale>(getStoredLocale());

if (typeof document !== "undefined") {
  document.documentElement.lang = locale();
}

export const t = translator(() => dictionaries[locale()], resolveTemplate);

export const i18n = {
  locale,
  setLocale: (next: Locale) => {
    setLocaleSignal(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
  },
  t,
  availableLocales: ["en", "zh-CN"] as Locale[],
  localeNames: {
    en: "English",
    "zh-CN": "中文",
  },
};
