'use server';

import { getTranslations } from 'next-intl/server';
import { fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { FIELD_LABELS, resolveApplyFields } from '@/lib/interviews/applyFields';
import { applicationPayload } from '@/lib/interviews/applyPayload';
import { removeCv, uploadCv } from '@/lib/interviews/cv';
import { isToken, newToken } from '@/lib/interviews/tokens';
import type { EditionSettings } from '@/lib/interviews/types';
import { editionByWalkinToken, loadWalkinSlots, walkinSettings } from '@/lib/interviews/walkins';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';

/**
 * A walk-in registering at the venue (0016). The same answers as the apply
 * form, one company, and the CV. Cheap refusals come first (the link, walk-ins
 * closed, a required answer missing, the company out of time today) so a 4 MB
 * CV is not uploaded for nothing; then the CV, then `submit_walkin`, which
 * checks everything again and queues the request for the reception desk. A
 * refused request deletes the CV it just uploaded. Returns the request's
 * token, which is the student's status page.
 */
export async function walkinAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const token = requiredText(formData, 'token');
  const locale = text(formData, 'locale') === 'en' ? 'en' : 'ar';

  // The honeypot: a person never sees this field. Pretend it worked.
  if (text(formData, 'website')) return ok('walkin');

  if (!isToken(token)) return fail('This link is not recognised.', 'bad_link');
  if (!isInterviewsConfigured()) return fail('Not available right now.', 'not_configured');
  const db = createInterviewsClient();

  const edition = await editionByWalkinToken(db, token);
  if (!edition) return fail('This link is not recognised.', 'bad_link');
  const { data } = await db.rpc('edition_settings', { p_edition: edition.id });
  const settings = data as EditionSettings | null;
  if (!walkinSettings(settings).open) return fail('Walk-in registration is closed right now.', 'walkins_closed');

  const fields = resolveApplyFields(settings?.apply_fields);
  const answers = applicationPayload(formData, fields, locale);
  if (answers.missing) {
    const t = await getTranslations({ locale, namespace: 'interviews' });
    return fail(t('errors.missing_answer', { question: t(FIELD_LABELS[answers.missing]) }));
  }
  const { preferences, ...rest } = answers.payload as { preferences: string[] } & Record<string, unknown>;
  const companyId = preferences[0];
  if (!companyId) return fail('Choose a company.', 'no_preferences');

  const slots = await loadWalkinSlots(db, edition.id);
  if (slots === null) return fail('Not available right now.', 'not_configured');
  if (!slots.some((s) => s.company_id === companyId)) {
    return fail('That company has no free time left today. Choose another.', 'no_walkin_slots');
  }

  const file = formData.get('cv');
  if (!(file instanceof File) || file.size === 0) return fail('Attach your CV as a PDF.', 'missing_cv');
  const uploaded = await uploadCv(db, edition.id, file);
  if ('error' in uploaded) return fail(uploaded.error, uploaded.error);

  const requestToken = newToken();
  const { error } = await db.rpc('submit_walkin', {
    p_token: token,
    p_payload: { ...rest, company_id: companyId, cv_path: uploaded.path },
    p_request_token: requestToken,
  });
  if (error) {
    await removeCv(db, uploaded.path);
    const refused = fromPostgrest(error);
    if (refused.hint) return refused;
    // The message is left out of the log; it can hold the email.
    console.error('[interviews/walkin] submit failed', error.code);
    return fail('Something went wrong. Try again.', 'generic');
  }

  return ok('walkin', { request: requestToken });
}
