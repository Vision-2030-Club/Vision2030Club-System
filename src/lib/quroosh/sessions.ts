import 'server-only';
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
