'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { all, fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';

/**
 * A task belongs to a project OR to a team, never both — the choice comes
 * from one radio group and a CHECK constraint backs it up.
 */
export async function createTaskAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const belongsTo = requiredText(formData, 'belongs_to');
  const me = await getMyMember();
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      title: requiredText(formData, 'title'),
      description: text(formData, 'description'),
      project_id: belongsTo === 'project' ? text(formData, 'project_id') : null,
      team_id: belongsTo === 'team' ? text(formData, 'team_id') : null,
      due_date: text(formData, 'due_date'),
      status: text(formData, 'status') ?? 'todo',
      created_by: me?.id ?? null,
    })
    .select('id')
    .single();

  if (error) return fail(error.message);

  // Multiple owners per task (spec §1).
  const assignees = all(formData, 'assignee_id');
  if (assignees.length > 0) {
    const { error: assignError } = await supabase
      .from('task_assignees')
      .insert(assignees.map((member_id) => ({ task_id: task.id, member_id })));
    if (assignError) return fail(assignError.message);
  }

  revalidatePath(`/${locale}/tasks`);
  return ok();
}

export async function updateTaskStatusAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase
    .from('tasks')
    .update({ status: requiredText(formData, 'status') })
    .eq('id', requiredText(formData, 'id'));

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/tasks`);
  return ok();
}
