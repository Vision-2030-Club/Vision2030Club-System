import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { GoogleNotConnectedError, isGoogleConfigured } from './auth';
import { createMeetingEvent, type InvitePayload } from './calendar';

/**
 * Turning a confirmed meeting into a Google invitation.
 *
 * The database never calls Google. A trigger that makes a network call holds
 * its transaction open for the length of that call and turns a Google outage
 * into "you cannot confirm your meeting" — so `app.hook_confirm_meeting` marks
 * the row `pending` instead, and this runs afterwards.
 *
 * Everything here uses the service-role client: `meeting_details` has no write
 * policy for anybody, and `meeting_invite_payload` is granted to the service
 * role alone because it returns real email addresses.
 */

export type MeetResult =
  | { status: 'ready'; link: string | null }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

/**
 * Creates the Meet link for one meeting, if it is waiting for one.
 *
 * Safe to call on anything: a meeting that is in person, already has its link,
 * or was never confirmed simply reports `skipped`. That is what lets the
 * caller be "whatever just transitioned a request" without knowing whether it
 * was a meeting at all.
 */
export async function ensureMeetLink(requestId: string): Promise<MeetResult> {
  const admin = createAdminClient();

  const { data: details } = await admin
    .from('meeting_details')
    .select('request_id, meet_state, meet_link')
    .eq('request_id', requestId)
    .maybeSingle();

  if (!details) return { status: 'skipped', reason: 'not a meeting' };
  if (details.meet_link) return { status: 'ready', link: details.meet_link as string };
  if (details.meet_state !== 'pending' && details.meet_state !== 'failed') {
    return { status: 'skipped', reason: `nothing to do (${details.meet_state})` };
  }

  if (!isGoogleConfigured()) {
    return await recordFailure(
      requestId,
      'Google is not set up on this server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
    );
  }

  const { data: payload, error: payloadError } = await admin.rpc('meeting_invite_payload', {
    p_request: requestId,
  });

  if (payloadError || !payload) {
    return await recordFailure(requestId, payloadError?.message ?? 'Could not read the meeting.');
  }

  try {
    const event = await createMeetingEvent(payload as InvitePayload);

    await admin
      .from('meeting_details')
      .update({
        meet_link: event.meetLink,
        meet_event_id: event.eventId,
        meet_state: 'ready',
        meet_error: null,
      })
      .eq('request_id', requestId);

    return { status: 'ready', link: event.meetLink };
  } catch (error) {
    const message =
      error instanceof GoogleNotConnectedError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unknown error talking to Google.';
    return await recordFailure(requestId, message);
  }
}

/**
 * A failure is recorded, never thrown onward.
 *
 * The meeting is already agreed and already on the club's own calendar; a
 * Google problem must not make it look like the confirmation did not happen.
 * The request page shows the message, and `retryPendingMeetLinks` picks it up
 * again later.
 */
async function recordFailure(requestId: string, message: string): Promise<MeetResult> {
  const admin = createAdminClient();
  await admin
    .from('meeting_details')
    .update({ meet_state: 'failed', meet_error: message })
    .eq('request_id', requestId);
  return { status: 'failed', error: message };
}

/**
 * Sweeps up whatever the confirming request could not finish — a Google
 * outage, an expired authorisation, a deploy landing mid-flight.
 *
 * Meant to be called from a scheduled job or the admin page. Bounded so one
 * pass cannot run away.
 */
export async function retryPendingMeetLinks(limit = 20): Promise<MeetResult[]> {
  const admin = createAdminClient();

  const { data: waiting } = await admin
    .from('meeting_details')
    .select('request_id')
    .in('meet_state', ['pending', 'failed'])
    .limit(limit);

  const results: MeetResult[] = [];
  for (const row of waiting ?? []) {
    // Sequential on purpose: these all hit one Google account, and firing
    // twenty at once is how a small club gets rate-limited.
    results.push(await ensureMeetLink(row.request_id as string));
  }
  return results;
}
