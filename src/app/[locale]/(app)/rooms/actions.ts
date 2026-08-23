'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { fail, fromPostgrest, ok, requiredText, type ActionResult } from '@/lib/actions';
import { IDENTITY_COOKIE, parseIdentity } from '@/lib/rooms';
import { CLUB_TIME_ZONE, clubTimestamp, minuteLabel } from '@/lib/time';

/**
 * Book a free slot (§4).
 *
 * Note what this does NOT do: it never checks whether the slot is still free.
 * `room_bookings_no_overlap` is the rule, and letting the insert fail against
 * it is the only version that stays correct when two people tap the same slot
 * at the same moment. Looking first would only widen the gap between the check
 * and the write. The same reasoning as the asset checkout path.
 */
export async function createBookingAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const me = await getMyMember();
  if (!me) return fail('Not signed in');

  const identity = parseIdentity(requiredText(formData, 'identity'));
  if (!identity) return fail('Choose who this booking is for.');

  const day = requiredText(formData, 'day');
  const startMinute = Number(requiredText(formData, 'start_minute'));
  const minutes = Number(requiredText(formData, 'minutes'));

  if (!Number.isInteger(startMinute) || ![30, 60].includes(minutes)) {
    return fail('Pick a start time and a length of 30 minutes or 1 hour.');
  }

  const supabase = await createClient();

  const { error } = await supabase.from('room_bookings').insert({
    room_id: requiredText(formData, 'room_id'),
    // Sent with the zone name so the value means one instant wherever this
    // runs — see src/lib/time.ts and migration 0027.
    starts_at: clubTimestamp(day, minuteLabel(startMinute), CLUB_TIME_ZONE),
    ends_at: clubTimestamp(day, minuteLabel(startMinute + minutes), CLUB_TIME_ZONE),
    status: 'booked',
    party_kind: identity.party_kind,
    team_id: identity.team_id,
    project_id: identity.project_id,
    booked_by: me.id,
    title: requiredText(formData, 'title'),
  });

  if (error) {
    if (error.message.includes('room_bookings_no_overlap')) {
      return fail('Someone booked that slot first. Pick another one.');
    }
    return fromPostgrest(error);
  }

  // §4: remembered as their default next time.
  const jar = await cookies();
  jar.set(IDENTITY_COOKIE, identity.value, {
    maxAge: 60 * 60 * 24 * 180,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });

  revalidatePath(`/${locale}/rooms`);
  return ok('created');
}

/**
 * Cancel a booking (§4: your own, any time, no approval).
 *
 * `room_bookings_delete` is what decides — you, or someone with rooms.manage.
 * A booking that is not yours simply matches no rows, which is what the empty
 * result below is reporting.
 */
export async function cancelBookingAction(
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
    return fail('That booking is gone already, or it is not yours to cancel.');
  }

  revalidatePath(`/${locale}/rooms`);
  return ok();
}
