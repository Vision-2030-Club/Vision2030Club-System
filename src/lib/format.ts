/**
 * Date/time formatting.
 *
 * Arabic here means Arabic *text* with the Gregorian calendar and Latin
 * digits (`-u-ca-gregory-nu-latn`). Without that, `ar` defaults to the Hijri
 * calendar and Arabic-Indic digits, which does not match how the club writes
 * dates in practice.
 */
function intlLocale(locale: string) {
  return locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB';
}

export function formatDate(value: string | Date | null | undefined, locale: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(intlLocale(locale), {
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
    hour: '2-digit',
    minute: '2-digit',
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

/** `2026-08-12` in the local timezone, for <input type="date"> values. */
export function toDateInput(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

/** `2026-08-12T14:30` for <input type="datetime-local"> values. */
export function toDateTimeInput(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}
