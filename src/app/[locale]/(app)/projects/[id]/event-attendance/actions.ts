'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { UUID } from '@/lib/eventAttendance/api';
import { kickPassDelivery } from '@/lib/eventAttendance/email';
import { tokenFromScan } from '@/lib/eventAttendance/links';
import { answer, refusal } from '@/lib/eventAttendance/refusal';
import type { EventAttendeeMatch, EventCheckInResult } from '@/lib/eventAttendance/types';
import { formatTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

/**
 * What signed-in people do in Event attendance (0075): the managers' settings
 * and list, and the gate.
 *
 * Every write goes to the club database as the person themselves, and each
 * `event_*` function decides whether they may (manager, or the HR team for
 * the gate). Nothing here checks a role: a refusal comes back with a hint,
 * translated from `eventAttendance.errors`.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function refresh(locale: string, projectId: string) {
  revalidatePath(`/${locale}/projects/${projectId}/event-attendance`, 'layout');
}

/** Opens or closes sign-up and sets the event's days. */
export async function saveSettingsAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const firstDay = text(formData, 'first_day');
  const lastDay = text(formData, 'last_day');
  if ((firstDay && !DAY.test(firstDay)) || (lastDay && !DAY.test(lastDay))) {
    return refusal(locale, 'days_invalid', 'The days are not valid.');
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('event_save_settings', {
    p_project: projectId,
    p_signup_open: formData.get('signup_open') === 'on',
    p_first_day: firstDay,
    p_last_day: lastDay,
  });
  if (!error) refresh(locale, projectId);
  return answer(locale, error);
}

/** Cancels an attendee's pass, or brings it back (`cancelled` = 'false'). */
export async function setCancelledAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const attendeeId = text(formData, 'attendee_id');
  if (!attendeeId || !UUID.test(attendeeId)) return refusal(locale, 'not_found', 'This attendee does not exist.');

  const supabase = await createClient();
  const { error } = await supabase.rpc('event_set_attendee_cancelled', {
    p_project: projectId,
    p_attendee: attendeeId,
    p_cancelled: text(formData, 'cancelled') !== 'false',
  });
  if (!error) refresh(locale, projectId);
  return answer(locale, error);
}

/** Queues an attendee's pass email again. */
export async function resendPassAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const attendeeId = text(formData, 'attendee_id');
  if (!attendeeId || !UUID.test(attendeeId)) return refusal(locale, 'not_found', 'This attendee does not exist.');

  const supabase = await createClient();
  const { data: queued, error } = await supabase.rpc('event_resend_pass', {
    p_project: projectId,
    p_attendee: attendeeId,
  });
  if (error) return answer(locale, error);
  if (queued !== true) return refusal(locale, 'pass_not_queued', 'No email on file, or a pass was sent a moment ago.');
  kickPassDelivery();
  refresh(locale, projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// The gate
// -----------------------------------------------------------------------------

/** What the scanner shows after a check-in: who, and when they first came in today. */
function checkedIn(result: EventCheckInResult, locale: string): ActionResult {
  return ok('saved', {
    result: result.result,
    attendee_id: result.attendee_id,
    name: result.name,
    time: formatTime(result.at, locale),
  });
}

/**
 * Checks in whoever's pass the camera read. `scanned` is the QR code's text:
 * a pass link from any address, or the bare token.
 */
export async function scanAction(projectId: string, locale: string, scanned: string): Promise<ActionResult> {
  const token = tokenFromScan(scanned);
  if (!token) return refusal(locale, 'unknown_code', 'This is not an event pass.');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('event_check_in', { p_project: projectId, p_token: token });
  if (error) return answer(locale, error);
  return checkedIn(data as EventCheckInResult, locale);
}

/** Checks in an attendee found by name or mobile. */
export async function checkInByIdAction(projectId: string, locale: string, attendeeId: string): Promise<ActionResult> {
  if (!UUID.test(attendeeId)) return refusal(locale, 'not_found', 'This attendee does not exist.');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('event_check_in', { p_project: projectId, p_attendee: attendeeId });
  if (error) return answer(locale, error);
  return checkedIn(data as EventCheckInResult, locale);
}

/** Undoes an attendee's check-in for today. */
export async function undoCheckInAction(projectId: string, locale: string, attendeeId: string): Promise<ActionResult> {
  if (!UUID.test(attendeeId)) return refusal(locale, 'not_found', 'This attendee does not exist.');
  const supabase = await createClient();
  const { error } = await supabase.rpc('event_undo_check_in', { p_project: projectId, p_attendee: attendeeId });
  return answer(locale, error);
}

/** Attendees matching part of a name or the end of a mobile number: at most twenty. */
export async function findAttendeesAction(
  projectId: string,
  query: string,
): Promise<{ ok: boolean; matches: EventAttendeeMatch[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('event_find_attendees', { p_project: projectId, p_query: query });
  if (error) return { ok: false, matches: [] };
  return { ok: true, matches: (data ?? []) as EventAttendeeMatch[] };
}

/**
 * The "Check in" button a manager or an HR member sees on a pass page they
 * opened with their own phone's camera. The same check-in as the scanner's.
 */
export async function checkInFromPassAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const result = await scanAction(projectId, locale, requiredText(formData, 'token'));
  if (!result.ok || !result.data) return result;
  const t = await getTranslations({ locale, namespace: 'eventAttendance.pass.staff' });
  const message =
    result.data.result === 'already'
      ? t('already', { name: result.data.name, time: result.data.time })
      : t('done', { name: result.data.name });
  return ok('saved', { ...result.data, message });
}
