'use server';

import { getTranslations } from 'next-intl/server';
import { fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { FIELD_LABELS, resolveApplyFields } from '@/lib/interviews/applyFields';
import { applicationPayload } from '@/lib/interviews/applyPayload';
import { removeCv, uploadCv } from '@/lib/interviews/cv';
import { kickRegistrationAppend } from '@/lib/interviews/registrationSheet';
import { newToken } from '@/lib/interviews/tokens';
import type { EditionSettings } from '@/lib/interviews/types';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';

/**
 * A student applying. The CV goes into the private bucket first, then
 * `submit_application` writes (or updates) the one row and its preferences.
 * If the database refuses — window closed, already reviewed, a bad choice —
 * the file just uploaded is deleted again, so a refused form leaves nothing
 * behind; if it accepts a re-submission, the previous CV is deleted instead.
 * An accepted submission is then appended to the registrations sheet, after
 * the response (registrationSheet.ts).
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

  // The questions this edition asks (lib/interviews/applyFields.ts). A
  // required one left blank is refused here, before the CV is uploaded.
  const { data: settings } = await db.rpc('edition_settings', { p_edition: editionId });
  const fields = resolveApplyFields((settings as EditionSettings | null)?.apply_fields);
  const answers = applicationPayload(formData, fields, locale);
  if (answers.missing) {
    const t = await getTranslations({ locale, namespace: 'interviews' });
    return fail(t('errors.missing_answer', { question: t(FIELD_LABELS[answers.missing]) }));
  }

  let cvPath: string | null = null;
  const file = formData.get('cv');
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadCv(db, editionId, file);
    if ('error' in uploaded) return fail(uploaded.error, uploaded.error);
    cvPath = uploaded.path;
  }

  const payload = { ...answers.payload, cv_path: cvPath };

  const { data, error } = await db.rpc('submit_application', {
    p_edition: editionId,
    p_payload: payload,
    p_token: newToken(),
  });

  if (error) {
    await removeCv(db, cvPath);
    return fromPostgrest(error);
  }

  const result = data as { id: string; replaced: boolean; previous_cv_path: string | null };
  await removeCv(db, result.previous_cv_path);
  kickRegistrationAppend(editionId, result.id, result.replaced);

  return ok('applied', { replaced: String(result.replaced) });
}
