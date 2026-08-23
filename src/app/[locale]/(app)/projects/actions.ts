'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';

export async function createProjectAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const me = await getMyMember();
  const supabase = await createClient();

  const { error } = await supabase.from('projects').insert({
    name_en: requiredText(formData, 'name_en'),
    name_ar: requiredText(formData, 'name_ar'),
    description: text(formData, 'description'),
    owning_team_id: requiredText(formData, 'owning_team_id'),
    status: text(formData, 'status') ?? 'active',
    starts_on: text(formData, 'starts_on'),
    ends_on: text(formData, 'ends_on'),
    created_by: me?.id ?? null,
  });

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects`);
  return ok();
}

/**
 * Staffing is independent of a person's home team, so any member can be added
 * to any project (spec §1).
 */
export async function addProjectMemberAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase
    .from('project_members')
    .insert({ project_id: projectId, member_id: requiredText(formData, 'member_id') });

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

/**
 * Up to 4 Project Managers. The limit is a trigger in the database, so this
 * action simply surfaces the error it raises rather than counting first.
 */
export async function addProjectManagerAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const memberId = requiredText(formData, 'member_id');
  const supabase = await createClient();

  const { error } = await supabase
    .from('project_managers')
    .insert({ project_id: projectId, member_id: memberId });

  if (error) return fail(error.message);

  // A manager who isn't already on the project team should be.
  await supabase
    .from('project_members')
    .upsert(
      { project_id: projectId, member_id: memberId },
      { onConflict: 'project_id,member_id', ignoreDuplicates: true },
    );

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

export async function removeProjectPersonAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const memberId = requiredText(formData, 'member_id');
  const table = requiredText(formData, 'table');

  if (table !== 'project_members' && table !== 'project_managers') {
    return fail('Unknown table');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('project_id', projectId)
    .eq('member_id', memberId);

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

// -----------------------------------------------------------------------------
// §3 — Splits
//
// Optional per project. A split has a free-text name, one or more PMs who
// confirm its tasks, and its own roster — and a person may sit in several
// splits of the same project, which is unrelated to the club-wide "one team per
// member" rule.
// -----------------------------------------------------------------------------

export async function createSplitAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const me = await getMyMember();
  const supabase = await createClient();

  const { error } = await supabase.from('project_splits').insert({
    project_id: projectId,
    name: requiredText(formData, 'name'),
    created_by: me?.id ?? null,
  });

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

export async function addSplitPersonAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const splitId = requiredText(formData, 'split_id');
  const memberId = requiredText(formData, 'member_id');
  const table = requiredText(formData, 'table');

  if (table !== 'project_split_members' && table !== 'project_split_managers') {
    return fail('Unknown table');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from(table)
    .insert({ split_id: splitId, member_id: memberId });

  if (error) return fail(error.message);

  // A split PM needs to be on the split's roster and on the project itself,
  // otherwise they cannot see the work they are responsible for.
  if (table === 'project_split_managers') {
    await supabase
      .from('project_split_members')
      .upsert(
        { split_id: splitId, member_id: memberId },
        { onConflict: 'split_id,member_id', ignoreDuplicates: true },
      );
  }
  await supabase
    .from('project_members')
    .upsert(
      { project_id: projectId, member_id: memberId },
      { onConflict: 'project_id,member_id', ignoreDuplicates: true },
    );

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

export async function removeSplitPersonAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const table = requiredText(formData, 'table');

  if (table !== 'project_split_members' && table !== 'project_split_managers') {
    return fail('Unknown table');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('split_id', requiredText(formData, 'split_id'))
    .eq('member_id', requiredText(formData, 'member_id'));

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

/**
 * Deleting a split does NOT delete its tasks — `tasks.split_id` is ON DELETE
 * SET NULL, so they fall back to project-wide and the project's PMs become
 * their confirmers. No score is touched, which matters because §7's "no way to
 * preserve a score by deleting" cuts both ways: no way to lose one either.
 */
export async function deleteSplitAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase
    .from('project_splits')
    .delete()
    .eq('id', requiredText(formData, 'split_id'));

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}
