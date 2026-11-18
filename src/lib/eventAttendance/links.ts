import { siteUrl } from '@/lib/site';

/**
 * The addresses Event attendance hands to people (0075), and how a day is
 * written. Like every shareable link in the app they start with the
 * production address, even on a Vercel preview.
 */

/** A pass token: 48 hex characters from `newToken()`. */
export const PASS_TOKEN = /^[0-9a-f]{32,128}$/;

/** The public sign-up form of a project's event. */
export function joinUrl(locale: string, projectId: string): string {
  return `${siteUrl()}/${locale}/event/join/${projectId}`;
}

/** A person's pass page. This is also what their QR code holds. */
export function passUrl(locale: string, token: string): string {
  return `${siteUrl()}/${locale}/event/pass/${token}`;
}

/** The pass's QR code as a PNG, for the email (an inline data URL is blocked there). */
export function passQrImageUrl(token: string): string {
  return `${siteUrl()}/api/event-attendance/qr/${token}`;
}

/**
 * The token inside whatever a scanner read: a pass link from any address
 * (production, a preview, either language) or the bare token. Null when it is
 * neither, e.g. somebody's Wi-Fi QR code.
 */
export function tokenFromScan(text: string): string | null {
  const value = text.trim();
  const fromLink = /\/event\/pass\/([0-9a-f]{32,128})(?:[/?#]|$)/.exec(value)?.[1];
  if (fromLink) return fromLink;
  return PASS_TOKEN.test(value) ? value : null;
}

/**
 * A day as people read it: "الأحد 22 نوفمبر" / "Sunday 22 November", Latin
 * digits, no year. The day is a calendar date already (the database made it
 * on the club's clock), so it is formatted at UTC noon and never shifts.
 */
export function eventDay(day: string, locale: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, date, 12)));
}

/** The event's days as one line, or null when none are set. */
export function eventDayRange(first: string | null, last: string | null, locale: string): string | null {
  if (!first || !last) return null;
  if (first === last) return eventDay(first, locale);
  return `${eventDay(first, locale)} – ${eventDay(last, locale)}`;
}
