import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { newToken } from '@/lib/interviews/tokens';
import { DEFAULT_COUNTRY, internationalPhone } from '@/lib/quroosh/phones';
import { createAdminClient } from '@/lib/supabase/admin';
import { kickPassDelivery } from '@/lib/eventAttendance/email';
import type { EventApiAttendee, EventApiCheckIn } from '@/lib/eventAttendance/types';

/**
 * Event attendance as other components use it (0075): register a person,
 * read the attendees, read the check-ins.
 *
 * A component inside this codebase imports these functions. Anything outside
 * it calls the same functions over HTTP (`/api/event-attendance/...`) with
 * `Authorization: Bearer $EVENT_ATTENDANCE_API_KEY`. Either way the caller is
 * trusted: these run with the service role and return personal data, so a
 * page must decide who is looking before it calls one.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type RegisterInput = {
  projectId: string;
  name: string;
  /** E.164, or a number as people type it; `country` reads the second kind. */
  phone: string;
  /** ISO country of a number typed without its code. Saudi Arabia by default. */
  country?: string;
  email?: string | null;
  locale?: string;
  /** Which component is registering them; 'form' is the component's own form. */
  source?: string;
  /** That component's own id for the person (an application id, say). */
  sourceRef?: string | null;
  /** The public form only: refuse while sign-up is closed. */
  requireOpen?: boolean;
  /** Email the pass. Off for a caller that sends its own message. */
  sendPass?: boolean;
};

export type RegisterResult =
  | { ok: true; attendeeId: string; token: string; created: boolean }
  | { ok: false; hint: string; message: string };

/**
 * Registers a person for a project's event and queues their pass email.
 * A mobile already registered answers with that attendee and `created:
 * false`, so calling it twice for one person is safe.
 */
export async function registerAttendee(input: RegisterInput): Promise<RegisterResult> {
  if (!UUID.test(input.projectId)) return { ok: false, hint: 'not_found', message: 'This event does not exist.' };
  const name = input.name.trim();
  if (name.length < 2 || name.length > 200) return { ok: false, hint: 'name_invalid', message: 'Write the full name.' };
  const phone = internationalPhone(input.country ?? DEFAULT_COUNTRY, input.phone);
  if (!phone) return { ok: false, hint: 'phone_invalid', message: 'The mobile number is not valid.' };
  const email = (input.email ?? '').trim().toLowerCase();
  if (email !== '' && (email.length > 254 || !EMAIL.test(email))) {
    return { ok: false, hint: 'email_invalid', message: 'The email address is not valid.' };
  }
  const source = input.source ?? 'form';
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(source)) {
    return { ok: false, hint: 'invalid', message: 'source must be a short lower-case key.' };
  }
  const sendPass = input.sendPass ?? true;

  const { data, error } = await createAdminClient().rpc('event_register', {
    p_project: input.projectId,
    p_token: newToken(),
    p_name: name,
    p_phone: phone,
    p_email: email === '' ? null : email,
    p_locale: input.locale === 'en' ? 'en' : 'ar',
    p_source: source,
    p_source_ref: input.sourceRef ?? null,
    p_require_open: input.requireOpen ?? false,
    p_send_pass: sendPass,
  });
  if (error) {
    const hint = error.hint && /^[a-z_]+$/.test(error.hint) ? error.hint : 'invalid';
    return { ok: false, hint, message: error.message };
  }
  const row = (data as { attendee_id: string; token: string; created: boolean }[] | null)?.[0];
  if (!row) return { ok: false, hint: 'invalid', message: 'The registration was not saved.' };

  if (sendPass && email !== '') kickPassDelivery();
  return { ok: true, attendeeId: row.attendee_id, token: row.token, created: row.created };
}

/**
 * The attendees of a project's event changed after `since` (all of them
 * without it), oldest change first, at most 5000. Page through a long list
 * by passing the last row's `updated_at`.
 */
export async function listAttendees(projectId: string, since?: string | null): Promise<EventApiAttendee[]> {
  const { data, error } = await createAdminClient().rpc('event_api_attendees', {
    p_project: projectId,
    p_since: since ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as EventApiAttendee[];
}

/**
 * The check-ins made or undone after `since`, oldest change first, at most
 * 5000. An undone check-in comes back with `undone_at` set. Page through by
 * passing the last row's `changed_at`.
 */
export async function listCheckIns(projectId: string, since?: string | null): Promise<EventApiCheckIn[]> {
  const { data, error } = await createAdminClient().rpc('event_api_check_ins', {
    p_project: projectId,
    p_since: since ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as EventApiCheckIn[];
}

/**
 * The attendees with these ids (club 0076), for a component that has read
 * check-ins and needs the people behind them. Ids of another project's
 * attendees are left out. Before 0076 is applied this throws, like the two
 * lists above; callers that run unattended catch it.
 */
export async function getAttendeesById(projectId: string, ids: string[]): Promise<EventApiAttendee[]> {
  const wanted = [...new Set(ids)].filter((id) => UUID.test(id));
  if (wanted.length === 0) return [];
  const { data, error } = await createAdminClient().rpc('event_api_attendees_by_id', {
    p_project: projectId,
    p_ids: wanted,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as EventApiAttendee[];
}

/** True when the HTTP API has a key on this deployment. */
export function isApiConfigured(): boolean {
  return Boolean(process.env.EVENT_ATTENDANCE_API_KEY);
}

/**
 * Whether a request carries the API key. Compared in constant time, and
 * always false while no key is set: an unset key must not mean "open".
 */
export function hasApiKey(request: Request): boolean {
  const key = process.env.EVENT_ATTENDANCE_API_KEY;
  if (!key) return false;
  const sent = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${key}`;
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A `since` query value as an instant, null when absent, or false when it is not a date. */
export function readSince(value: string | null): string | null | false {
  if (value === null || value === '') return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? false : at.toISOString();
}
