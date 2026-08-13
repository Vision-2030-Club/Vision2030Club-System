'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';

/**
 * Records attendance (spec §9).
 *
 * `event_id` stays untouched: it is the placeholder for a future Events
 * module, and nothing should start writing it until that module defines what
 * an event is.
 */
export async function recordAttendanceAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const me = await getMyMember();
  const supabase = await createClient();

  const { error } = await supabase.from('attendance_records').insert({
    member_id: requiredText(formData, 'member_id'),
    activity_name: requiredText(formData, 'activity_name'),
    occurred_at: new Date(requiredText(formData, 'occurred_at')).toISOString(),
    status: requiredText(formData, 'status'),
    note: text(formData, 'note'),
    recorded_by: me?.id ?? null,
  });

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/attendance`);
  return ok();
}
