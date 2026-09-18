'use server';

import { redirect } from '@/i18n/navigation';
import { fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { removeCv, uploadCv } from '@/lib/interviews/cv';
import { newToken } from '@/lib/interviews/tokens';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';

/**
 * A candidate identifying themselves on one room's link (0005): name, phone,
 * optionally a CV. No email, no secret token to keep — the link itself, plus
 * the phone number, is the whole of it. `room_login` resolves the link,
 * records (or updates) the applicant, and says whether HR already accepted
 * them for this one company. Accepted candidates are sent straight to their
 * personal booking page, which already knows how to show slots and take a
 * booking for every company that accepted them — this form does not
 * duplicate any of that.
 */
export async function roomLoginAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const token = requiredText(formData, 'room_token');
  const locale = text(formData, 'locale') === 'en' ? 'en' : 'ar';

  if (!isInterviewsConfigured()) return fail('Not available right now.', 'not_configured');
  const db = createInterviewsClient();

  const { data: company } = await db
    .from('companies')
    .select('id, edition_id')
    .eq('candidate_token', token)
    .maybeSingle();
  if (!company) return fail('This link is not recognised.', 'bad_link');

  let cvPath: string | null = null;
  const file = formData.get('cv');
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadCv(db, company.edition_id, file);
    if ('error' in uploaded) return fail(uploaded.error, uploaded.error);
    cvPath = uploaded.path;
  }

  const { data, error } = await db.rpc('room_login', {
    p_room_token: token,
    p_name: text(formData, 'name'),
    p_phone: text(formData, 'phone'),
    p_cv: cvPath,
    p_new_token: newToken(),
  });

  if (error) {
    await removeCv(db, cvPath);
    return fromPostgrest(error);
  }

  const result = data as { personal_token: string; accepted: boolean };
  if (!result.accepted) {
    return ok('notAccepted');
  }

  return redirect({ href: `/interviews/s/${result.personal_token}`, locale });
}
