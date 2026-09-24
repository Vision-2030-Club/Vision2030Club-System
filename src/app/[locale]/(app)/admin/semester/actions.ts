'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { fail, fromPostgrest, ok, requiredText, type ActionResult } from '@/lib/actions';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The database decides who may set the semester: `semester_settings_update`
 * asks `app.can('calendar.manage')`, which only club scope satisfies. This
 * action turns the form into an update and hands back what Postgres said.
 */
export async function updateSemesterAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const startsOn = requiredText(formData, 'starts_on');
  const endsOn = requiredText(formData, 'ends_on');

  if (!DAY.test(startsOn) || !DAY.test(endsOn)) {
    return fail('Dates must look like 2026-08-08.');
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from('semester_settings')
    .update({
      name_en: requiredText(formData, 'name_en'),
      name_ar: requiredText(formData, 'name_ar'),
      starts_on: startsOn,
      ends_on: endsOn,
    })
    .eq('id', true)
    .select('id');

  if (error) return fromPostgrest(error);
  // RLS hides the row rather than refusing, so a silent zero-row update is
  // the "not permitted" case here.
  if (!updated?.length) return fail('Nothing was saved: setting the semester is not yours to do.');

  revalidatePath(`/${locale}/admin/semester`);
  revalidatePath(`/${locale}/dashboard`);
  return ok();
}
