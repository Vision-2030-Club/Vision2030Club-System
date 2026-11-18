import 'server-only';
import { createHash } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { newToken, TOKEN_PATTERN } from '@/lib/interviews/tokens';
import { siteUrl } from '@/lib/site';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * Guest accounts (Quroosh 0006): the public who came to the event.
 *
 * A guest has no password and is not a club member. They get in with a
 * one-time link emailed to them, and stay in with a session cookie set by
 * this server. Neither the link's token nor the cookie's value is stored:
 * the Quroosh database keeps their SHA-256, so reading it signs nobody in.
 *
 * `getGuestAccount()` is the question every later Quroosh page for guests
 * asks (the market, their quroosh): who, if anyone, is signed in here.
 */

/** The cookie that holds a guest's session. HttpOnly: no script reads it. */
const SESSION_COOKIE = 'quroosh_guest';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export type GuestAccount = {
  account_id: string;
  project_id: string;
  /** The club's Event attendance attendee this account belongs to. */
  attendee_id: string;
  name: string;
  email: string;
  locale: 'ar' | 'en';
};

/** `account_link`: what a one-time link's page shows. */
export type AccountLink = {
  state: 'valid' | 'used' | 'expired' | 'disabled';
  kind: 'complete' | 'signin';
  project_id: string;
  name: string;
  phone: string | null;
  email: string;
  completed: boolean;
};

/** `account_list`: one row of the managers' list. */
export type AccountRow = {
  id: string;
  attendee_id: string;
  name: string;
  phone: string | null;
  email: string;
  checked_in_at: string;
  created_at: string;
  completed_at: string | null;
  disabled_at: string | null;
  emailed_at: string | null;
  email_error: string | null;
  last_seen_at: string | null;
};

/** What the database keeps instead of a token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The address in an account email. Always the production site, like every link people are sent. */
export function accountLinkUrl(locale: string, token: string): string {
  return `${siteUrl()}/${locale}/quroosh/account/link/${token}`;
}

/** Where a guest signs in and, once in, finds their account. */
export function accountHomePath(projectId: string): string {
  return `/quroosh/account/${projectId}`;
}

/**
 * The guest signed in on this device, or null. One query per request, shared
 * by whatever asks. Null also before 0006 is applied, when the Quroosh
 * database is not configured, and for an account that was disabled.
 */
export const getGuestAccount = cache(async (): Promise<GuestAccount | null> => {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value || !TOKEN_PATTERN.test(value) || !isQurooshConfigured()) return null;
  const { data } = await createQurooshClient().rpc('account_session', { p_session_hash: hashToken(value) });
  return ((data as GuestAccount[] | null) ?? [])[0] ?? null;
});

/** What a link's page shows, or null for a link nobody made. Reading it does not use it up. */
export async function readAccountLink(token: string): Promise<AccountLink | null> {
  if (!TOKEN_PATTERN.test(token) || !isQurooshConfigured()) return null;
  const { data } = await createQurooshClient().rpc('account_link', { p_token_hash: hashToken(token) });
  return ((data as AccountLink[] | null) ?? [])[0] ?? null;
}

/**
 * Uses a one-time link: the account is completed if it was not, and this
 * device is signed in. Only from a server action (it sets a cookie). A
 * refusal comes back as the database's hint: `link_used`, `link_expired`,
 * `account_disabled`, `not_found`.
 */
export async function redeemAccountLink(
  token: string,
): Promise<{ ok: true; projectId: string; newlyCompleted: boolean } | { ok: false; hint: string }> {
  if (!TOKEN_PATTERN.test(token) || !isQurooshConfigured()) return { ok: false, hint: 'not_found' };
  const session = newToken();
  const { data, error } = await createQurooshClient().rpc('use_account_link', {
    p_token_hash: hashToken(token),
    p_session_hash: hashToken(session),
  });
  if (error) return { ok: false, hint: error.hint && /^[a-z_]+$/.test(error.hint) ? error.hint : 'invalid' };
  const row = (data as { project_id: string; newly_completed: boolean }[] | null)?.[0];
  if (!row) return { ok: false, hint: 'invalid' };

  (await cookies()).set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax, not strict: the guest arrives from a link in their mail app.
    sameSite: 'lax',
    path: '/',
    maxAge: THIRTY_DAYS,
  });
  return { ok: true, projectId: row.project_id, newlyCompleted: row.newly_completed };
}

/** Signs this device out. Only from a server action. */
export async function endGuestSession(): Promise<void> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  if (value && TOKEN_PATTERN.test(value) && isQurooshConfigured()) {
    await createQurooshClient().rpc('end_account_session', { p_session_hash: hashToken(value) });
  }
  store.delete(SESSION_COOKIE);
}

/** A mobile with its middle hidden: enough to recognise, not enough to copy. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.length <= 7 ? phone : `${phone.slice(0, 4)} ••• ${phone.slice(-3)}`;
}
