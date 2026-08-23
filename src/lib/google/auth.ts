import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The club's one Google connection.
 *
 * Everything here runs through the SERVICE-ROLE client, because
 * `google_credentials` has RLS enabled with no policies at all — nothing a
 * signed-in user does can read it. That makes this the third and last place in
 * the codebase allowed to use the service role, alongside creating an auth
 * account on first login and a Super Admin password reset.
 *
 * The client ID and secret identify the *application* and live in environment
 * variables. The refresh token identifies the *account* and lives in the
 * database, so re-authorising is a button rather than a redeploy.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * Full Calendar access. We only ever write to the club's own secondary
 * calendar — which is a promise this code keeps, not one the scope enforces.
 * Google's narrower app-created-calendars scope would enforce it, but it is
 * newer than this project's Google account and not worth risking the setup on.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
];

export type GoogleCredentials = {
  refresh_token: string;
  scopes: string[];
  google_email: string | null;
  calendar_id: string | null;
  connected_at: string;
};

export class GoogleNotConnectedError extends Error {
  constructor() {
    super(
      'The club Google account is not connected yet. A Super Admin can connect it under Admin → Google.',
    );
    this.name = 'GoogleNotConnectedError';
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local — see Admin → Google for what it should contain.`,
    );
  }
  return value;
}

/** True when the app itself is configured, whether or not an account is linked. */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(): string {
  // Explicit rather than derived from the request: Google matches this string
  // exactly against the Authorised redirect URI registered in the Cloud
  // console, so guessing it from a header is how this breaks in production.
  return requireEnv('GOOGLE_REDIRECT_URI');
}

/** Where to send a Super Admin to grant access. */
export function consentUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    // `offline` is what makes Google return a refresh token at all, and
    // `consent` forces it to be re-issued even if this account has approved
    // before — without it, a second connection attempt silently yields no
    // token and the connection looks broken for no visible reason.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function getCredentials(): Promise<GoogleCredentials | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('google_credentials')
    .select('refresh_token, scopes, google_email, calendar_id, connected_at')
    .eq('id', true)
    .maybeSingle();
  return (data as GoogleCredentials) ?? null;
}

export async function saveCredentials(values: {
  refresh_token: string;
  scopes: string[];
  google_email: string | null;
  connected_by: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('google_credentials').upsert(
    {
      id: true,
      ...values,
      // A new account means the old club calendar is not ours any more.
      calendar_id: null,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw new Error(error.message);
}

export async function clearCredentials(): Promise<void> {
  const admin = createAdminClient();
  await admin.from('google_credentials').delete().eq('id', true);
}

export async function setCalendarId(calendarId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from('google_credentials').update({ calendar_id: calendarId }).eq('id', true);
}

/*
 * Access tokens last an hour, so they are held in module memory rather than
 * fetched per call. This is a cache, not state: a cold start or a second
 * server instance simply refreshes again, which is correct, just slower.
 */
let cached: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const credentials = await getCredentials();
  if (!credentials) throw new GoogleNotConnectedError();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: credentials.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // The usual cause is the club revoking access in their Google settings, so
    // the message points at the fix rather than at the HTTP status.
    throw new Error(
      `Google refused the club's saved authorisation (${body?.error ?? response.status}). ` +
        'Reconnect the account under Admin → Google.',
    );
  }

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

/** Exchanges the one-time code from the consent screen for a refresh token. */
export async function exchangeCode(code: string): Promise<{
  refresh_token: string;
  scopes: string[];
  email: string | null;
}> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Google rejected the authorisation: ${body?.error ?? response.status}`);
  }
  if (!body.refresh_token) {
    throw new Error(
      'Google returned no refresh token. Remove the club system from the account\'s third-party access at myaccount.google.com and try again.',
    );
  }

  // The email is only for showing "connected as …" on the admin page.
  let email: string | null = null;
  try {
    const me = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    email = (await me.json())?.email ?? null;
  } catch {
    email = null;
  }

  // A fresh token invalidates whatever was cached for the previous account.
  cached = null;

  return {
    refresh_token: body.refresh_token,
    scopes: String(body.scope ?? '').split(' ').filter(Boolean),
    email,
  };
}
