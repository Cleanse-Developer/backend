// Single source of truth for supported storefront languages (backend side).
// Adding a language = add its code here (and author/seed its content).
//
// Storage convention for per-locale CMS content: English uses the BARE settings
// key (`cmsHero`) for full back-compat; every other locale uses a suffixed key
// (`cmsHero_hi`). Serving overlays the locale doc over English, so a missing
// locale — or a missing field within it — transparently falls back to English.

const SUPPORTED_LOCALES = ["en", "hi"]; // add "ta", "bn", ... here
const DEFAULT_LOCALE = "en";
const NON_DEFAULT_LOCALES = SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE);

// Bare key for the default locale, suffixed key otherwise.
const localeKey = (baseKey, locale) =>
  locale === DEFAULT_LOCALE ? baseKey : `${baseKey}_${locale}`;

// Clamp an arbitrary input to a supported locale (defaults to English).
const normalizeLocale = (locale) =>
  SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;

// Expand a list of base CMS keys into every locale variant (bare + suffixed).
// Used to derive the admin write-whitelist and the public read-whitelist so a
// new language needs no per-key edits.
const withLocaleVariants = (baseKeys) =>
  baseKeys.flatMap((key) =>
    SUPPORTED_LOCALES.map((locale) => localeKey(key, locale))
  );

module.exports = {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  NON_DEFAULT_LOCALES,
  localeKey,
  normalizeLocale,
  withLocaleVariants,
};
