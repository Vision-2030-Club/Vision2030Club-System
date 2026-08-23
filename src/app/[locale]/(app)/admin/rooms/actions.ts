'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { fail, fromPostgrest, ok, requiredText, type ActionResult } from '@/lib/actions';

function revalidateRooms(locale: string) {
  revalidatePath(`/${locale}/admin/rooms`);
  revalidatePath(`/${locale}/rooms`);
}

/**
 * Every write here is checked by the database first — `rooms_write` and
 * `room_bookings_insert` both ask `app.can('rooms.manage')`. Nothing in this
 * file re-checks who you are; it only turns form fields into rows and hands
 * back whatever the database said if it refused.
 */
export async function createRoomAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase.from('rooms').insert({
    name_en: requiredText(formData, 'name_en'),
    name_ar: requiredText(formData, 'name_ar'),
  });

  if (error) return fromPostgrest(error);

  revalidateRooms(locale);
  return ok('created');
}

export async function renameRoomAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase
    .from('rooms')
    .update({
      name_en: requiredText(formData, 'name_en'),
      name_ar: requiredText(formData, 'name_ar'),
    })
    .eq('id', requiredText(formData, 'room_id'));

  if (error) return fromPostgrest(error);

  revalidateRooms(locale);
  return ok();
}

/**
 * Retire or bring back a room.
 *
 * §4: a room with bookings behind it is never deleted, only hidden from new
 * ones. That is not enforced here by remembering to — migration 0026 grants no
 * DELETE on `rooms` at all, so this flag is the only way a room leaves the
 * list, and its history survives either way.
 */
export async function setRoomActiveAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase
    .from('rooms')
    .update({ is_active: formData.get('is_active') === 'true' })
    .eq('id', requiredText(formData, 'room_id'));

  if (error) return fromPostgrest(error);

  revalidateRooms(locale);
  return ok();
}

/** The one global window, for every room (§4). */
export async function updateBookingSettingsAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');

  const opens = minuteOfDay(requiredText(formData, 'opens_at'));
  const closes = minuteOfDay(requiredText(formData, 'closes_at'));
  const daysAhead = Number(requiredText(formData, 'days_ahead'));

  if (opens === null || closes === null) {
    return fail('Opening and closing times must look like 13:30.');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('booking_settings')
    .update({
      opens_minute: opens,
      // Midnight is the END of the day here, so 00:00 means 1440 rather than 0.
      closes_minute: closes === 0 ? 1440 : closes,
      days_ahead: daysAhead,
    })
    .eq('id', true);

  if (error) return fromPostgrest(error);

  revalidateRooms(locale);
  return ok();
}

/**
 * IT taking a room out of service (§4).
 *
 * A block is an ordinary row in `room_bookings`, which is what makes it behave
 * "exactly like a real booking": the same exclusion constraint stops anyone
 * booking over it, and the same schedule query displays it. The only
 * differences are `party_kind = 'block'` and that `title` carries IT's reason
 * instead of a group name.
 */
export async function blockRoomTimeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const me = await getMyMember();
  if (!me) return fail('Not signed in');

  const day = requiredText(formData, 'day');
  const from = requiredText(formData, 'starts_at');
  const to = requiredText(formData, 'ends_at');

  if (to <= from) {
    return fail('The end time must be after the start time.');
  }

  const supabase = await createClient();

  /*
   * "14:00 on the 22nd" is not an instant until you say whose clock. Postgres
   * accepts a zone NAME in a timestamp literal, so appending the club's zone
   * makes the value mean the same thing no matter what timezone the database
   * or this server happens to be set to. Migration 0027 is where that setting
   * lives, and the booking trigger reads the same one.
   */
  const { data: settings } = await supabase
    .from('booking_settings')
    .select('time_zone')
    .eq('id', true)
    .maybeSingle();

  const zone = (settings?.time_zone as string) ?? 'Asia/Riyadh';
  const at = (time: string) => `${day} ${time}:00 ${zone}`;

  const { error } = await supabase.from('room_bookings').insert({
    room_id: requiredText(formData, 'room_id'),
    starts_at: at(from),
    ends_at: at(to),
    status: 'blocked',
    party_kind: 'block',
    booked_by: me.id,
    title: requiredText(formData, 'reason'),
  });

  // The overlap constraint is the rule, so we let it fail rather than looking
  // first — the same reasoning as the asset checkout path.
  if (error) {
    if (error.message.includes('room_bookings_no_overlap')) {
      return fail('Something is already booked in that room for part of that time.');
    }
    return fromPostgrest(error);
  }

  revalidateRooms(locale);
  return ok('created');
}

/** IT removing any booking, including someone else's (§4). */
export async function deleteBookingAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { data: deleted, error } = await supabase
    .from('room_bookings')
    .delete()
    .eq('id', requiredText(formData, 'booking_id'))
    .select('id');

  if (error) return fromPostgrest(error);
  if (!deleted?.length) {
    return fail('That booking is gone already, or it is not yours to remove.');
  }

  revalidateRooms(locale);
  return ok();
}

/** "13:30" -> 810. Returns null if it is not a time at all. */
function minuteOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}
