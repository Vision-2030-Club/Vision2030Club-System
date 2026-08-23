import { CLUB_TIME_ZONE } from '@/lib/time';

/**
 * Date/time formatting.
 *
 * Arabic here means Arabic *text* with the Gregorian calendar and Latin
 * digits (`-u-ca-gregory-nu-latn`). Without that, `ar` defaults to the Hijri
 * calendar and Arabic-Indic digits, which does not match how the club writes
 * dates in practice.
 *
 * Every formatter below is pinned to the CLUB's timezone. Left unset, `Intl`
 * uses whatever timezone the Node process runs in — Riyadh on a developer's
 * laptop, UTC on a host — so the same booking would read as 14:00 locally and
 * 11:00 in production. See src/lib/time.ts.
 */
function intlLocale(locale: string) {
  return locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB';
}

export function formatDate(value: string | Date | null | undefined, locale: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: CLUB_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatDateTime(
  value: string | Date | null | undefined,
  locale: string,
) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: CLUB_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatTime(value: string | Date | null | undefined, locale: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: CLUB_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

/** Pick the field matching the active locale from a `*_en` / `*_ar` pair. */
export function localized<T extends Record<string, unknown>>(
  row: T | null | undefined,
  base: string,
  locale: string,
): string {
  if (!row) return '';
  const key = `${base}_${locale === 'ar' ? 'ar' : 'en'}`;
  return String(row[key] ?? row[`${base}_en`] ?? '');
}

/*
 * `toDateInput` / `toDateTimeInput` moved to src/lib/time.ts and are
 * re-exported here so the many pages already importing them keep working. They
 * now read the club's clock rather than the server's.
 */
export { toDateInput, toDateTimeInput } from '@/lib/time';
