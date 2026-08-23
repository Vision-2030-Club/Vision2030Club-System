import 'server-only';
import { CLUB_TIME_ZONE } from '@/lib/time';
import { getAccessToken, getCredentials, setCalendarId } from './auth';

/**
 * Writing the club's meetings to Google.
 *
 * Two things are deliberate here:
 *
 *   1. Events go on a SECONDARY calendar named for the club, created once and
 *      remembered. §3 asked for the shared account's own calendar to stay
 *      clean; a personal Google account supports extra calendars, so it can,
 *      and the club calendar can be hidden with one checkbox.
 *
 *   2. The Meet link is minted BY the event (`conferenceData.createRequest`)
 *      rather than by the Meet API. The Meet API is a Workspace product and
 *      cannot send invitations in any case — invitations, RSVPs and "this is
 *      in your calendar" are all properties of a Calendar event.
 */

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const CLUB_CALENDAR_NAME = 'KSU Vision 2030 Club — Meetings';

async function googleFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `Google returned ${response.status}`;
    throw new Error(message);
  }
  return body;
}

/**
 * The club's calendar id, creating the calendar the first time.
 *
 * Stored rather than looked up by name each time: two calendars could share a
 * name, and we would rather keep writing to the one we made than pick again.
 */
export async function ensureClubCalendar(): Promise<string> {
  const credentials = await getCredentials();
  if (credentials?.calendar_id) return credentials.calendar_id;

  const created = await googleFetch('/calendars', {
    method: 'POST',
    body: JSON.stringify({
      summary: CLUB_CALENDAR_NAME,
      description:
        'Meetings agreed in the Vision 2030 Club system. Created automatically — nothing here needs editing by hand.',
      timeZone: CLUB_TIME_ZONE,
    }),
  });

  await setCalendarId(created.id);
  return created.id as string;
}

export type InvitePayload = {
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  location: string | null;
  is_online: boolean;
  attendees: string[];
};

export type CreatedEvent = { eventId: string; meetLink: string | null };

/**
 * Creates the event, its Meet link, and its invitations in one call.
 *
 * `sendUpdates=all` is what actually mails everybody; `conferenceDataVersion=1`
 * is what lets Google act on `createRequest` instead of ignoring it. Both are
 * easy to leave off, and leaving either off fails silently — the event appears
 * with no link, or with a link nobody was told about.
 */
export async function createMeetingEvent(payload: InvitePayload): Promise<CreatedEvent> {
  const calendarId = await ensureClubCalendar();

  const body: Record<string, unknown> = {
    summary: payload.title,
    description: payload.description ?? undefined,
    location: payload.location ?? undefined,
    start: { dateTime: payload.starts_at, timeZone: CLUB_TIME_ZONE },
    end: { dateTime: payload.ends_at, timeZone: CLUB_TIME_ZONE },
    attendees: payload.attendees.map((email) => ({ email })),
    guestsCanModify: false,
    reminders: { useDefault: true },
  };

  // A room booking needs no Meet link. §2 only asks for one when the meeting
  // is online — and an unused link in an invitation invites people to use it.
  if (payload.is_online) {
    body.conferenceData = {
      createRequest: {
        // Google requires this to be unique per request; it deduplicates
        // retries, which is exactly what we want if this call is repeated.
        requestId: `v2030-${crypto.randomUUID()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const event = await googleFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events` +
      '?conferenceDataVersion=1&sendUpdates=all',
    { method: 'POST', body: JSON.stringify(body) },
  );

  const meetLink =
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find(
      (point: { entryPointType?: string; uri?: string }) => point.entryPointType === 'video',
    )?.uri ??
    null;

  return { eventId: event.id as string, meetLink };
}

/** Removes an event, e.g. if a confirmed meeting is later undone. */
export async function deleteMeetingEvent(eventId: string): Promise<void> {
  const calendarId = await ensureClubCalendar();
  await googleFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}` +
      '?sendUpdates=all',
    { method: 'DELETE' },
  );
}
