'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { getMyMember } from '@/lib/auth/session';
import { all, fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import {
  can,
  requireInterviewAccess,
  type ComponentRole,
  type InterviewAccess,
} from '@/lib/interviews/access';
import { newPin, newToken } from '@/lib/interviews/tokens';
import { deliverPendingEmails, kickEmailDelivery } from '@/lib/interviews/email';
import { takeExport } from '@/lib/interviews/export';
import type { Stage } from '@/lib/interviews/types';
import { fromClubWallClock } from '@/lib/time';

/**
 * Every write the signed-in pages make to the interviews database.
 *
 * The shape is the same each time: the club database says whether this
 * person may act (`requireInterviewAccess`), then a Postgres function in the
 * interviews database does the one thing asked and refuses with a sentence
 * if it cannot. Nothing here decides a rule; it carries form fields to the
 * function and the function's answer back to the form.
 */

type Guarded =
  | { access: InterviewAccess & { edition: NonNullable<InterviewAccess['edition']> }; projectId: string; locale: string }
  | { error: string };

async function guard(
  formData: FormData,
  allowed: (role: ComponentRole) => boolean,
): Promise<Guarded> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  try {
    const access = await requireInterviewAccess(projectId, allowed);
    return { access, projectId, locale };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Not allowed.' };
  }
}

/** Everything under /projects/<id>/interviews reads the second database live. */
function revalidate(locale: string, projectId: string) {
  revalidatePath(`/${locale}/projects/${projectId}/interviews`, 'layout');
}

/** `2026-04-21T14:00` from a datetime-local input, or null when blank. */
function instantOrNull(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value ? fromClubWallClock(value).toISOString() : null;
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export async function updateEditionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const keys = all(formData, 'rating_key');
  const ens = all(formData, 'rating_en');
  const ars = all(formData, 'rating_ar');
  const rating_labels = keys
    .map((key, i) => ({
      key: key.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
      en: ens[i] ?? '',
      ar: ars[i] ?? '',
    }))
    .filter((label) => label.key && (label.en || label.ar));

  const numberField = (key: string, fallback: number) => {
    const value = Number(text(formData, key) ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  };

  const db = createInterviewsClient();
  const { error } = await db.rpc('update_edition', {
    p_edition: g.access.edition.id,
    p_patch: {
      name_en: text(formData, 'name_en') ?? undefined,
      name_ar: text(formData, 'name_ar') ?? undefined,
      public_slug: text(formData, 'public_slug') ?? undefined,
      status: text(formData, 'status') ?? undefined,
      apply_opens_at: instantOrNull(formData, 'apply_opens_at'),
      apply_closes_at: instantOrNull(formData, 'apply_closes_at'),
      booking_opens_at: instantOrNull(formData, 'booking_opens_at'),
      booking_closes_at: instantOrNull(formData, 'booking_closes_at'),
      settings: {
        max_preferences: numberField('max_preferences', 4),
        change_cutoff_hours: numberField('change_cutoff_hours', 12),
        tv_call_minutes: numberField('tv_call_minutes', 5),
        feedback_email_mode:
          text(formData, 'feedback_email_mode') === 'immediately' ? 'immediately' : 'on_release',
        ...(rating_labels.length ? { rating_labels } : {}),
      },
    },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

export async function rotateTvTokenAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('rotate_tv_token', {
    p_edition: g.access.edition.id,
    p_token: newToken(),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

export async function releaseFeedbackAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { data, error } = await db.rpc('release_feedback', {
    p_edition: g.access.edition.id,
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  revalidate(g.locale, g.projectId);
  return ok('saved', { released: String(data ?? 0) });
}

export async function exportNowAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  try {
    const result = await takeExport(createInterviewsClient(), g.access.edition.id, g.access.actor);
    revalidate(g.locale, g.projectId);
    return ok('saved', { path: result.path });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Export failed.');
  }
}

// -----------------------------------------------------------------------------
// Rooms and companies
// -----------------------------------------------------------------------------

export async function upsertRoomAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('upsert_room', {
    p_edition: g.access.edition.id,
    p_room: text(formData, 'room_id'),
    p_payload: {
      name: text(formData, 'name'),
      note: text(formData, 'note') ?? '',
      sort_order: text(formData, 'sort_order'),
      is_active: text(formData, 'is_active'),
    },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

export async function upsertCompanyAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const companyId = text(formData, 'company_id');
  const pinChoice = text(formData, 'pin_choice'); // keep | none | new | typed
  const payload: Record<string, unknown> = {
    name_en: text(formData, 'name_en'),
    name_ar: text(formData, 'name_ar'),
    logo_url: text(formData, 'logo_url') ?? '',
    desc_en: text(formData, 'desc_en') ?? '',
    desc_ar: text(formData, 'desc_ar') ?? '',
    is_hidden: formData.get('is_hidden') === 'on',
    sort_order: text(formData, 'sort_order'),
  };
  if (!companyId) payload.access_token = newToken();
  if (pinChoice === 'none') payload.access_pin = '';
  else if (pinChoice === 'new') payload.access_pin = newPin();
  else if (pinChoice === 'typed') payload.access_pin = text(formData, 'access_pin') ?? '';

  const db = createInterviewsClient();
  const { error } = await db.rpc('upsert_company', {
    p_edition: g.access.edition.id,
    p_company: companyId,
    p_payload: payload,
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

/**
 * The simplified "room" flow (0005): one button creates the room, the
 * company behind it (with its own candidate-facing link), and a full week of
 * 2pm–8pm/15-minute sessions — Oct 12–16, 2026 — so nothing further needs
 * scheduling by hand. Each step is its own transaction in the database; if a
 * later step fails the earlier ones stand, same as every other admin form
 * here that is not meant to be re-run under load.
 */
const ROOM_EVENT_DAYS = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
const ROOM_SLOT_START = '14:00';
const ROOM_SLOT_END = '20:00';
const ROOM_SLOT_MINUTES = 15;

export async function createRoomAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const name = requiredText(formData, 'name');
  const logoUrl = text(formData, 'logo_url') ?? '';
  const db = createInterviewsClient();

  const { data: room, error: roomError } = await db.rpc('upsert_room', {
    p_edition: g.access.edition.id,
    p_room: null,
    p_payload: { name },
    p_actor: g.access.actor,
  });
  if (roomError) return fromPostgrest(roomError);

  const { data: company, error: companyError } = await db.rpc('upsert_company', {
    p_edition: g.access.edition.id,
    p_company: null,
    p_payload: {
      name_en: name,
      name_ar: name,
      logo_url: logoUrl,
      access_token: newToken(),
      candidate_token: newToken(),
    },
    p_actor: g.access.actor,
  });
  if (companyError) return fromPostgrest(companyError);

  for (const day of ROOM_EVENT_DAYS) {
    const { error: sessionError } = await db.rpc('create_session', {
      p_edition: g.access.edition.id,
      p_payload: {
        company_id: company.id,
        room_id: room.id,
        day,
        start_time: ROOM_SLOT_START,
        end_time: ROOM_SLOT_END,
        slot_minutes: ROOM_SLOT_MINUTES,
      },
      p_actor: g.access.actor,
    });
    if (sessionError) return fromPostgrest(sessionError);
  }

  revalidate(g.locale, g.projectId);
  return ok('created');
}

/** HR's pre-approval list for one room: phone numbers, one per line. */
export async function acceptPhonesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.decide);
  if ('error' in g) return fail(g.error);

  const companyId = requiredText(formData, 'company_id');
  const phones = Array.from(
    new Set(
      (text(formData, 'phones') ?? '')
        .split(/[\s,]+/)
        .map((p) => p.trim())
        .filter(Boolean),
    ),
  );
  if (phones.length === 0) return fail('Enter at least one phone number.');

  const db = createInterviewsClient();
  for (const phone of phones) {
    const { error } = await db.rpc('accept_phone', {
      p_edition: g.access.edition.id,
      p_company: companyId,
      p_phone: phone,
      p_token: newToken(),
      p_actor: g.access.actor,
    });
    if (error) return fromPostgrest(error);
  }

  revalidate(g.locale, g.projectId);
  return ok('saved', { count: String(phones.length) });
}

/**
 * A plain form action (no useActionState, no per-row error UI) — same shape
 * as signOutAction in the app layout. Removing a phone from an "accepted"
 * list is low-stakes and reversible by pasting it back in, so it does not
 * need a confirmation dialog or its own feedback state.
 */
export async function unacceptPhoneAction(formData: FormData): Promise<void> {
  const g = await guard(formData, can.decide);
  if ('error' in g) return;

  const db = createInterviewsClient();
  await db.rpc('unaccept_phone', {
    p_edition: g.access.edition.id,
    p_company: requiredText(formData, 'company_id'),
    p_phone: requiredText(formData, 'phone'),
    p_actor: g.access.actor,
  });

  revalidate(g.locale, g.projectId);
}

export async function rotateCompanyTokenAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('rotate_company_token', {
    p_company: requiredText(formData, 'company_id'),
    p_token: newToken(),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// Sessions and slots
// -----------------------------------------------------------------------------

export async function createSessionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('create_session', {
    p_edition: g.access.edition.id,
    p_payload: {
      company_id: requiredText(formData, 'company_id'),
      room_id: requiredText(formData, 'room_id'),
      day: requiredText(formData, 'day'),
      start_time: requiredText(formData, 'start_time'),
      end_time: requiredText(formData, 'end_time'),
      slot_minutes: Number(requiredText(formData, 'slot_minutes')),
    },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok('created');
}

export async function extendSessionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('extend_session', {
    p_session: requiredText(formData, 'session_id'),
    p_end_time: requiredText(formData, 'end_time'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

export async function deleteSessionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('delete_session', {
    p_session: requiredText(formData, 'session_id'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

export async function setSlotClosedAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('set_slot_closed', {
    p_slot: requiredText(formData, 'slot_id'),
    p_closed: formData.get('closed') === 'true',
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// People — the roster lives in the CLUB database, written as the user, so its
// policies (0062) decide: organizers by whoever manages the project, HR
// people by whoever manages members.
// -----------------------------------------------------------------------------

export async function addPersonAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.roster);
  if ('error' in g) return fail(g.error);

  const role = requiredText(formData, 'role');
  if (role !== 'organizer' && role !== 'hr') return fail('Unknown role.');

  const me = await getMyMember();
  const supabase = await createClient();
  const { error } = await supabase.from('project_component_people').insert({
    project_id: g.projectId,
    member_id: requiredText(formData, 'member_id'),
    role,
    added_by: me?.id ?? null,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

export async function removePersonAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.roster);
  if ('error' in g) return fail(g.error);

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from('project_component_people')
    .delete()
    .eq('project_id', g.projectId)
    .eq('member_id', requiredText(formData, 'member_id'))
    .eq('role', requiredText(formData, 'role'))
    .select('member_id');
  if (error) return fromPostgrest(error);
  if (!deleted?.length) return fail('Nothing removed — that is not yours to change.');

  revalidate(g.locale, g.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// Selection
// -----------------------------------------------------------------------------

export async function decideAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.decide);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('decide_preference', {
    p_application: requiredText(formData, 'application_id'),
    p_company: requiredText(formData, 'company_id'),
    p_decision: requiredText(formData, 'decision'),
    p_note: text(formData, 'note'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  // The first acceptance queued the student's link; send it now, not at the
  // next sweep.
  kickEmailDelivery();
  revalidate(g.locale, g.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// The day: stages, called from the floor board (an object, not a form)
// -----------------------------------------------------------------------------

export async function stageAction(input: {
  projectId: string;
  locale: string;
  bookingId: string;
  to: Stage;
}): Promise<ActionResult> {
  let access: InterviewAccess;
  try {
    access = await requireInterviewAccess(input.projectId, can.stage);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Not allowed.');
  }

  const db = createInterviewsClient();
  const { error } = await db.rpc('advance_stage', {
    p_booking: input.bookingId,
    p_to: input.to,
    p_actor: access.actor,
    p_as_manager: can.manage(access.role),
  });
  if (error) return fromPostgrest(error);

  revalidate(input.locale, input.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// Bookings, by a manager on a student's behalf
// -----------------------------------------------------------------------------

export async function staffBookAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('staff_book_slot', {
    p_application: requiredText(formData, 'application_id'),
    p_slot: requiredText(formData, 'slot_id'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  revalidate(g.locale, g.projectId);
  return ok('created');
}

export async function staffMoveAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('staff_move_booking', {
    p_booking: requiredText(formData, 'booking_id'),
    p_slot: requiredText(formData, 'slot_id'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  revalidate(g.locale, g.projectId);
  return ok();
}

export async function staffCancelAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('staff_cancel_booking', {
    p_booking: requiredText(formData, 'booking_id'),
    p_reason: text(formData, 'reason'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  revalidate(g.locale, g.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// The outbox
// -----------------------------------------------------------------------------

export async function sendPendingEmailsAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  try {
    const report = await deliverPendingEmails(100, 25_000);
    revalidate(g.locale, g.projectId);
    return ok('saved', {
      claimed: String(report.claimed),
      sent: String(report.sent),
      failed: String(report.failed),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Sending failed.');
  }
}

export async function retryEmailAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('retry_email', {
    p_id: requiredText(formData, 'email_id'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  revalidate(g.locale, g.projectId);
  return ok();
}
