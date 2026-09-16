'use server';

import { all, fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { removeCv, uploadCv } from '@/lib/interviews/cv';
import { newToken } from '@/lib/interviews/tokens';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';

/**
 * A student applying. The CV goes into the private bucket first, then
 * `submit_application` writes (or updates) the one row and its preferences.
 * If the database refuses — window closed, already reviewed, a bad choice —
 * the file just uploaded is deleted again, so a refused form leaves nothing
 * behind; if it accepts a re-submission, the previous CV is deleted instead.
 */
export async function applyAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const editionId = requiredText(formData, 'edition_id');
  const locale = text(formData, 'locale') === 'en' ? 'en' : 'ar';

  // The honeypot: a person never sees this field. Pretend it worked.
  if (text(formData, 'website')) return ok('applied');

  if (!isInterviewsConfigured()) return fail('Applications are not available right now.', 'not_configured');
  const db = createInterviewsClient();

  let cvPath: string | null = null;
  const file = formData.get('cv');
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadCv(db, editionId, file);
    if ('error' in uploaded) return fail(uploaded.error, uploaded.error);
    cvPath = uploaded.path;
  }

  const university = text(formData, 'university');
  const payload = {
    email: text(formData, 'email'),
    name: text(formData, 'name'),
    phone: text(formData, 'phone'),
    is_club_member: formData.get('is_club_member') === 'yes',
    university,
    university_other: university === 'other' ? text(formData, 'university_other') : null,
    level: text(formData, 'level'),
    college: text(formData, 'college'),
    major: text(formData, 'major'),
    gpa: text(formData, 'gpa'),
    english_level: text(formData, 'english_level'),
    why_first: text(formData, 'why_first'),
    locale,
    preferences: all(formData, 'preference'),
    cv_path: cvPath,
  };

  const { data, error } = await db.rpc('submit_application', {
    p_edition: editionId,
    p_payload: payload,
    p_token: newToken(),
  });

  if (error) {
    await removeCv(db, cvPath);
    return fromPostgrest(error);
  }

  const result = data as { replaced: boolean; previous_cv_path: string | null };
  await removeCv(db, result.previous_cv_path);

  return ok('applied', { replaced: String(result.replaced) });
}
