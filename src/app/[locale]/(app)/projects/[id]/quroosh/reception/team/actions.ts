'use server';

import { revalidatePath } from 'next/cache';
import { fail, fromPostgrest, ok, requiredText, type ActionResult } from '@/lib/actions';
import { getMyMember, scopeFor } from '@/lib/auth/session';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { createClient } from '@/lib/supabase/server';

/**
 * Adding and removing a project's receptionists (club 0069's list, used by
 * Quroosh since 0078). Both write `project_component_people` in the club
 * database as the person themselves, so the table's policy is the rule: the
 * project's managers, or whoever holds members.manage. The check here only
 * gives a clear refusal before the database's.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard(formData: FormData): Promise<{ projectId: string; locale: string; memberId: string } | { error: string }> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const memberId = requiredText(formData, 'member_id');
  if (!UUID.test(projectId) || !UUID.test(memberId)) return { error: 'Not found.' };
  const [access, membersScope] = await Promise.all([getQurooshAccess(projectId), scopeFor('members.manage')]);
  if (!access || !(can.manage(access.role) || membersScope === 'all')) {
    return { error: 'Only the project managers and HR Directors choose the reception team.' };
  }
  return { projectId, locale, memberId };
}

function refresh(locale: string, projectId: string) {
  revalidatePath(`/${locale}/projects/${projectId}/quroosh`, 'layout');
}

export async function addReceptionistAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard(formData);
  if ('error' in g) return fail(g.error);

  const me = await getMyMember();
  const supabase = await createClient();
  const { error } = await supabase.from('project_component_people').insert({
    project_id: g.projectId,
    member_id: g.memberId,
    role: 'reception',
    added_by: me?.id ?? null,
  });
  if (error) return fromPostgrest(error);

  refresh(g.locale, g.projectId);
  return ok();
}

export async function removeReceptionistAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await guard(formData);
  if ('error' in g) return fail(g.error);

  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from('project_component_people')
    .delete()
    .eq('project_id', g.projectId)
    .eq('member_id', g.memberId)
    .eq('role', 'reception')
    .select('member_id');
  if (error) return fromPostgrest(error);
  if (!removed?.length) return fail('Nothing removed — that is not yours to change.');

  refresh(g.locale, g.projectId);
  return ok();
}
