import 'server-only';
import { cookies } from 'next/headers';
import { getGuestAccount } from '@/lib/quroosh/accounts';
import { siteUrl } from '@/lib/site';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * Checking in to the day's dialogue session (Quroosh 0009).
 *
 * The organizers show one QR code at the session, permanent and one per
 * project: `/quroosh/checkin/<project id>`. A signed-in guest opens it, rates
 * the session from one to five stars and checks in, once a day on the club's
 * calendar, and the Quroosh database pays their wallet in the same
 * transaction (`session_check_in`).
 *
 * Every read answers null (or an empty list) before 0009 is applied, so the
 * pages can say so instead of crashing.
 */

export type SessionToday = { day: string; rating: number; points: number; created_at: string };
export type SessionDay = { day: string; check_ins: number; average_rating: number };

/** The check-in page, without the language: what a redirect or a stored return path holds. */
export function sessionCheckInPath(projectId: string): string {
  return `/quroosh/checkin/${projectId}`;
}

/** The address in the session's QR code. Always the production site, like every printed link. */
export function sessionCheckInUrl(locale: string, projectId: string): string {
  return `${siteUrl()}/${locale}${sessionCheckInPath(projectId)}`;
}

/**
 * Today's check-in of a guest account, or null if they have not checked in
 * today. `undefined` when the database could not answer (0009 not applied).
 */
export async function getSessionToday(accountId: string): Promise<SessionToday | null | undefined> {
  if (!isQurooshConfigured()) return undefined;
  const { data, error } = await createQurooshClient().rpc('session_today', { p_account: accountId });
  if (error) return undefined;
  const row = (data as SessionToday[] | null)?.[0];
  return row ? { ...row, rating: Number(row.rating), points: Number(row.points) } : null;
}

/** What a check-in pays, or null before 0009 is applied. */
export async function getSessionPoints(projectId: string): Promise<number | null> {
  if (!isQurooshConfigured()) return null;
  const { data, error } = await createQurooshClient().rpc('session_points', { p_project: projectId });
  return error || typeof data !== 'number' ? null : data;
}

/** Check-ins and the average rating, day by day, newest first. Null before 0009. */
export async function getSessionSummary(projectId: string): Promise<SessionDay[] | null> {
  if (!isQurooshConfigured()) return null;
  const { data, error } = await createQurooshClient().rpc('session_summary', { p_project: projectId });
  if (error) return null;
  return ((data ?? []) as SessionDay[]).map((row) => ({
    day: row.day,
    check_ins: Number(row.check_ins),
    average_rating: Number(row.average_rating),
  }));
}

/**
 * Checks a guest in with their rating and pays their wallet. A refusal comes
 * back as the database's hint: `already_checked_in`, `rating_invalid`,
 * `account_disabled`, `not_found`, or `not_ready` when 0009 is missing.
 */
export async function checkInToSession(
  accountId: string,
  projectId: string,
  rating: number,
): Promise<{ ok: true; points: number } | { ok: false; hint: string }> {
  if (!isQurooshConfigured()) return { ok: false, hint: 'not_ready' };
  const { data, error } = await createQurooshClient().rpc('session_check_in', {
    p_account: accountId,
    p_project: projectId,
    p_rating: rating,
  });
  if (error) {
    // PGRST202: the function does not exist yet.
    if (error.code === 'PGRST202') return { ok: false, hint: 'not_ready' };
    return { ok: false, hint: error.hint && /^[a-z_]+$/.test(error.hint) ? error.hint : 'invalid' };
  }
  const row = (data as { day: string; points: number }[] | null)?.[0];
  return row ? { ok: true, points: Number(row.points) } : { ok: false, hint: 'invalid' };
}

// -----------------------------------------------------------------------------
// Checking in with an email alone (Quroosh 0011)
// -----------------------------------------------------------------------------

/**
 * Who is checking in on this device, for the session check-in page and its
 * action only. Either the signed-in guest (the session cookie of 0006), or
 * the account whose email was typed on this page (0011).
 *
 * A typed email is not proof of who typed it. So `byEmail` is good for one
 * thing, rating the session and checking in; it is never a sign-in, and no
 * other page may accept it. The wallet still needs the emailed link.
 */
export type CheckInGuest = { account_id: string; name: string; byEmail: boolean };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Remembers the email typed at the session check-in, so tomorrow's scan goes straight to the stars. */
const CHECKIN_COOKIE = 'quroosh_checkin';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

/** An email as the accounts hold it, or null when it is not one. */
export function cleanEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/**
 * The account with this email in this project: null when there is none (or
 * it is disabled), `undefined` when the database cannot answer (0011 not
 * applied), so the page can fall back to the emailed sign-in link.
 */
export async function findSessionAccount(
  projectId: string,
  email: string,
): Promise<{ account_id: string; name: string } | null | undefined> {
  if (!isQurooshConfigured()) return undefined;
  const { data, error } = await createQurooshClient().rpc('session_account_by_email', {
    p_project: projectId,
    p_email: email,
  });
  if (error) return undefined;
  return (data as { account_id: string; name: string }[] | null)?.[0] ?? null;
}

/** Whether checking in by email works on this deployment (0011 applied). */
export async function canCheckInByEmail(projectId: string): Promise<boolean> {
  return (await findSessionAccount(projectId, '')) !== undefined;
}

/** Remembers the typed email for this project's check-in page. Only from a server action. */
export async function rememberCheckInEmail(projectId: string, email: string): Promise<void> {
  (await cookies()).set(CHECKIN_COOKIE, `${projectId}:${email}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: THIRTY_DAYS,
  });
}

/** Forgets it ("not you?"). Only from a server action. */
export async function forgetCheckInEmail(): Promise<void> {
  (await cookies()).delete(CHECKIN_COOKIE);
}

/**
 * Who is checking in here, or null: the signed-in guest of this project if
 * there is one, otherwise the account of the email typed on this device.
 * The email is looked up again on every request, so a disabled account or a
 * corrected email stops working at once.
 */
export async function getCheckInGuest(projectId: string): Promise<CheckInGuest | null> {
  const account = await getGuestAccount();
  // A session of another project's account is nobody here.
  if (account && account.project_id === projectId) {
    return { account_id: account.account_id, name: account.name, byEmail: false };
  }
  const [cookieProject, ...rest] = ((await cookies()).get(CHECKIN_COOKIE)?.value ?? '').split(':');
  const email = cleanEmail(rest.join(':'));
  if (cookieProject !== projectId || !email) return null;
  const found = await findSessionAccount(projectId, email);
  return found ? { ...found, byEmail: true } : null;
}
