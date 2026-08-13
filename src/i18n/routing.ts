import { defineRouting } from 'next-intl/routing';

/**
 * Arabic is the club's default language, so `/` resolves to `/ar`.
 * `localePrefix: 'always'` keeps every URL unambiguous, which makes the
 * proxy's auth redirects easy to reason about.
 */
export const routing = defineRouting({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

/** Text direction per locale — used for `<html dir>` and RTL-aware layout. */
export const localeDirection: Record<Locale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
  en: 'ltr',
};
