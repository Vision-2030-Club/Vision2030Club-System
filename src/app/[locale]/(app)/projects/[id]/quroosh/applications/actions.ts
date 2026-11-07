'use server';

import { revalidatePath } from 'next/cache';
import { getMyMember } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { fail, fromPostgrest, requiredText, text, type ActionResult } from '@/lib/actions';

/**
 * The managers' side of the Quroosh form (0075): open or close it, and the
 * privacy notice it links to. The policies on quroosh_settings refuse anyone
 * who does not manage the project.
 */
async function saveSettings(
  projectId: string,
  locale: string,
  values: { applications_open?: boolean; privacy_url?: string | null },
): Promise<ActionResult> {
  const me = await getMyMember();
  if (!me) return fail('Not signed in');
  const supabase = await createClient();
  const { error } = await supabase
    .from('quroosh_settings')
    .upsert(
      { project_id: projectId, ...values, updated_at: new Date().toISOString(), updated_by: me.id },
      { onConflict: 'project_id' },
    );
  revalidatePath(`/${locale}/projects/${projectId}/quroosh/applications`);
  return fromPostgrest(error);
}

export async function setApplicationsOpenAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return saveSettings(requiredText(formData, 'project_id'), requiredText(formData, 'locale'), {
    applications_open: formData.get('open') === 'true',
  });
}

export async function savePrivacyUrlAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const url = text(formData, 'privacy_url');
  if (url !== null && !/^https?:\/\//.test(url)) return fail('The link must start with https://');
  return saveSettings(requiredText(formData, 'project_id'), requiredText(formData, 'locale'), {
    privacy_url: url,
  });
}
