import 'server-only';
import { createHash } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { getAttendeesById, registerAttendee } from '@/lib/eventAttendance/api';
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

/**
 * The address in an account email. Always the production site, like every
 * link people are sent. `next` says where the link leads once it has signed
 * the guest in: 'checkin' is the session check-in they asked for it from.
 * It travels in the link itself, because the link is often opened in another
 * browser than the one that asked (a mail app's own), where no cookie follows.
 */
export function accountLinkUrl(locale: string, token: string, next?: 'checkin'): string {
  return `${siteUrl()}/${locale}/quroosh/account/link/${token}${next ? `?next=${next}` : ''}`;
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

  await setSessionCookie(session);
  return { ok: true, projectId: row.project_id, newlyCompleted: row.newly_completed };
}

/** Signs this device in with a session the database has just stored. Only from a server action. */
async function setSessionCookie(session: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax, not strict: the guest arrives from a link in their mail app.
    sameSite: 'lax',
    path: '/',
    maxAge: THIRTY_DAYS,
  });
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type SignUpResult = { ok: true; bonus: number } | { ok: false; hint: string; message: string };

/**
 * A guest makes their own account (Quroosh 0017, the club's decision of
 * 2026-11-26): name, mobile and email, no pass, no gate, no email to confirm.
 * The account is signed in on this device at once and paid the sign-up bonus.
 * Only from a server action (it sets a cookie).
 *
 * 1. An email that already has an account is refused (`account_exists`)
 *    before anyone is registered: they sign in with the emailed link.
 * 2. The person is registered in Event attendance (club database), one per
 *    mobile, with no pass email, so reception still finds them by name.
 * 3. A mobile registered before is only accepted with the email it was
 *    registered with (`phone_taken` otherwise), and the account takes the
 *    attendee's own details, as the gate's sync would.
 * 4. `account_sign_up` makes the account, its session and the bonus in one
 *    transaction, and refuses an attendee who already has an account.
 *
 * So a session is only ever started for an account this call made: nobody
 * signs in to somebody else's wallet by knowing their email or mobile.
 */
export async function signUpGuest(input: {
  projectId: string;
  name: string;
  phone: string;
  country: string;
  email: string;
  locale: 'ar' | 'en';
}): Promise<SignUpResult> {
  if (!isQurooshConfigured()) return { ok: false, hint: 'not_configured', message: 'Quroosh is not configured.' };
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    return { ok: false, hint: 'email_invalid', message: 'The email address is not valid.' };
  }

  const db = createQurooshClient();
  const taken = await db.rpc('account_email_taken', { p_project: input.projectId, p_email: email });
  // An error here is 0017 not applied yet: say so rather than register anyone.
  if (taken.error) return { ok: false, hint: 'signup_not_ready', message: taken.error.message };
  if (taken.data === true) return { ok: false, hint: 'account_exists', message: 'This email already has an account.' };

  const registered = await registerAttendee({
    projectId: input.projectId,
    name: input.name,
    phone: input.phone,
    country: input.country,
    email,
    locale: input.locale,
    source: 'quroosh_signup',
    requireOpen: true,
    sendPass: false,
  });
  if (!registered.ok) return { ok: false, hint: registered.hint, message: registered.message };

  const attendee = (await getAttendeesById(input.projectId, [registered.attendeeId]).catch(() => []))[0];
  if (!attendee) return { ok: false, hint: 'invalid', message: 'The registration could not be read back.' };
  if (!registered.created && (attendee.email ?? '').toLowerCase() !== email) {
    // Never say which email: whoever typed the number may not be its owner.
    return { ok: false, hint: 'phone_taken', message: 'This mobile number is registered with another email.' };
  }

  const session = newToken();
  const { data, error } = await db.rpc('account_sign_up', {
    p_project: input.projectId,
    p_attendee: attendee.id,
    p_name: attendee.name,
    p_phone: attendee.phone,
    p_email: email,
    p_locale: input.locale,
    p_session_hash: hashToken(session),
  });
  if (error) {
    return { ok: false, hint: error.hint && /^[a-z_]+$/.test(error.hint) ? error.hint : 'invalid', message: error.message };
  }
  const row = (data as { account_id: string; bonus: number }[] | null)?.[0];
  if (!row) return { ok: false, hint: 'invalid', message: 'The account was not made.' };

  await setSessionCookie(session);
  return { ok: true, bonus: Number(row.bonus) };
}

/**
 * Where to send a guest once a sign-in link has signed them in, when they
 * asked for the link from a page other than their account (the session
 * check-in). The link is emailed, so the page is remembered on this device
 * for an hour, longer than a sign-in link lasts (fifteen minutes). Opened on
 * another device, the link lands on the account page as before.
 */
const RETURN_COOKIE = 'quroosh_return';
const ONE_HOUR = 60 * 60;

/** Only the session check-in page, as a path without the language: never another site. */
export function safeReturnPath(value: unknown): string | null {
  const path = typeof value === 'string' ? value : '';
  return /^\/quroosh\/checkin\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)
    ? path
    : null;
}

/** Remembers a page to come back to. Only from a server action. */
export async function rememberReturnPath(path: string | null): Promise<void> {
  const store = await cookies();
  if (!path) {
    store.delete(RETURN_COOKIE);
    return;
  }
  store.set(RETURN_COOKIE, path, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_HOUR,
  });
}

/** The page remembered by `rememberReturnPath`, forgotten as it is read. Only from a server action. */
export async function takeReturnPath(): Promise<string | null> {
  const store = await cookies();
  const path = safeReturnPath(store.get(RETURN_COOKIE)?.value);
  store.delete(RETURN_COOKIE);
  return path;
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
