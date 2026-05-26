// i18n configuration — central source of truth for supported locales.
//
// Status: scaffold. UI strings for NL/EN/DE/FR live in `/messages/*.json`.
// Page-level migration to `[locale]/` is a follow-up — content translation
// (foutcodes, parts, guides) requires a separate batch job with a translation
// API (OpenAI/DeepL) and human review.

export const locales = ["nl", "en", "de", "fr"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "nl";

export const localeNames: Record<Locale, string> = {
  nl: "Nederlands",
  en: "English",
  de: "Deutsch",
  fr: "Français",
};

export const localeFlags: Record<Locale, string> = {
  nl: "🇳🇱",
  en: "🇬🇧",
  de: "🇩🇪",
  fr: "🇫🇷",
};

// Currency by locale (with country detection override later)
export const localeCurrency: Record<Locale, "EUR" | "GBP"> = {
  nl: "EUR",
  en: "EUR", // default — UK users get GBP via geo-detection
  de: "EUR",
  fr: "EUR",
};

// SEO slug translations — used to translate URL paths per language.
// Example: /onderdelen (NL) → /parts (EN) → /ersatzteile (DE) → /pieces (FR)
export const slugMap: Record<string, Record<Locale, string>> = {
  diagnose: { nl: "diagnose", en: "diagnose", de: "diagnose", fr: "diagnostic" },
  foutcodes: { nl: "foutcodes", en: "error-codes", de: "fehlercodes", fr: "codes-erreur" },
  onderdelen: { nl: "onderdelen", en: "parts", de: "ersatzteile", fr: "pieces" },
  gidsen: { nl: "gidsen", en: "guides", de: "anleitungen", fr: "guides" },
  merken: { nl: "merken", en: "brands", de: "marken", fr: "marques" },
  monteur: { nl: "monteur", en: "for-technicians", de: "fuer-techniker", fr: "pour-techniciens" },
  prijzen: { nl: "prijzen", en: "pricing", de: "preise", fr: "tarifs" },
  help: { nl: "help", en: "help", de: "hilfe", fr: "aide" },
  blog: { nl: "blog", en: "blog", de: "blog", fr: "blog" },
};

// Build a path in a specific locale.
// `/foutcodes/Bosch-E18` in NL → `/en/error-codes/Bosch-E18` in EN.
export function localizedPath(path: string, locale: Locale): string {
  if (locale === defaultLocale) return path;
  // Translate the first segment if it's in our slug map
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return `/${locale}`;
  const [first, ...rest] = segments;
  const translated = slugMap[first]?.[locale] ?? first;
  return `/${locale}/${[translated, ...rest].join("/")}`;
}

// Compute hreflang map for any path — used in metadata to set
// alternates.languages for SEO.
export function hreflangMap(path: string): Record<string, string> {
  const base = "https://wasfix.nl";
  return {
    nl: `${base}${localizedPath(path, "nl")}`,
    en: `${base}${localizedPath(path, "en")}`,
    de: `${base}${localizedPath(path, "de")}`,
    fr: `${base}${localizedPath(path, "fr")}`,
    "x-default": `${base}${localizedPath(path, "en")}`,
  };
}
