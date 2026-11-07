'use server';

import { revalidatePath } from 'next/cache';
import { fail, fromPostgrest, requiredText, text, type ActionResult } from '@/lib/actions';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * The managers' side of the Quroosh form: open or close it, and the privacy
 * notice it links to. The club database answers whether this person manages
 * the project (`getQurooshAccess`); only then is the Quroosh database
 * written, recording who (`save_settings`, supabase/quroosh).
 */
async function saveSettings(
  formData: FormData,
  values: { p_open?: boolean; p_privacy_url?: string },
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const access = await getQurooshAccess(projectId);
  if (!access || !can.manage(access.role)) return fail('Only the project’s managers can change this.');
  if (!isQurooshConfigured()) return fail('The Quroosh database is not configured on this deployment.');

  const { error } = await createQurooshClient().rpc('save_settings', {
    p_project: projectId,
    p_actor: access.me.id,
    ...values,
  });
  revalidatePath(`/${locale}/projects/${projectId}/quroosh/applications`);
  return fromPostgrest(error);
}

export async function setApplicationsOpenAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return saveSettings(formData, { p_open: formData.get('open') === 'true' });
}

export async function savePrivacyUrlAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const url = text(formData, 'privacy_url');
  if (url !== null && !/^https?:\/\//.test(url)) return fail('The link must start with https://');
  // An empty field clears the link.
  return saveSettings(formData, { p_privacy_url: url ?? '' });
}
