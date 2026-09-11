'use server';

import { revalidatePath } from 'next/cache';
import { kickPushDelivery } from '@/lib/push';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';

/**
 * Task actions.
 *
 * Everything that moves a task through its lifecycle goes through a database
 * function — never a plain UPDATE. §1 says status is computed and never set by
 * hand, and a trigger enforces that: a direct PATCH of submitted_at,
 * confirmed_at or not_done_at is rejected no matter who sends it. These
 * actions are thin wrappers that surface the database's own message.
 */

/*
 * `/kpi` is deliberately NOT here. It issues five unfiltered aggregate reads
 * over every task in the club, and revalidating it on every claim, submit and
 * confirm made the cheapest buttons in the system pay for the most expensive
 * page. It is a report; it can be a few seconds stale.
 */
function paths(locale: string, projectId?: string | null) {
  const list = [`/${locale}/tasks`, `/${locale}/dashboard`];
  if (projectId) list.push(`/${locale}/projects/${projectId}`);
  return list;
}

function revalidate(locale: string, projectId?: string | null) {
  for (const path of paths(locale, projectId)) revalidatePath(path);
}

/**
 * A task belongs to a project OR to a team, never both. Project tasks may
 * additionally sit in one split (§3), and may be left unassigned so somebody
 * can claim them.
 */
export async function createTaskAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const belongsTo = requiredText(formData, 'belongs_to');
  const isProject = belongsTo === 'project';
  const assignee = text(formData, 'assignee_id');
  const me = await getMyMember();
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      title: requiredText(formData, 'title'),
      description: text(formData, 'description'),
      project_id: isProject ? text(formData, 'project_id') : null,
      team_id: isProject ? null : text(formData, 'team_id'),
      split_id: isProject ? text(formData, 'split_id') : null,
      due_date: text(formData, 'due_date'),
      created_by: me?.id ?? null,
      // §3: the Assigned Date is when someone actually took the work on. A task
      // posted for claiming has none until it is claimed.
      assigned_at: assignee ? new Date().toISOString() : null,
    })
    .select('id, project_id')
    .single();

  if (error) return fail(error.message);

  if (assignee) {
    const { error: assignError } = await supabase
      .from('task_assignees')
      .insert({ task_id: task.id, member_id: assignee });
    if (assignError) return fail(assignError.message);
  }

  kickPushDelivery();
  revalidate(locale, task.project_id);
  return ok();
}

/** §3: claiming sets the Assigned Date to this moment. */
export async function claimTaskAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase.rpc('claim_task', {
    p_task: requiredText(formData, 'task_id'),
  });

  if (error) return fail(error.message);

  kickPushDelivery();
  revalidate(locale, text(formData, 'project_id'));
  return ok('claimed');
}

/**
 * §2.2: the assignee's own "I am done" — which is NOT the same as the task
 * being done. This fixes the Completion Date at this exact moment, whenever a
 * confirmer eventually gets to it.
 */
export async function submitTaskAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase.rpc('submit_task_for_review', {
    p_task: requiredText(formData, 'task_id'),
    // Work that came from a Design or Media request is delivered as a link.
    // Whether one is REQUIRED is the database's call — the request type says
    // so, not this action.
    p_url: text(formData, 'submission_url'),
  });

  if (error) return fail(error.message);

  kickPushDelivery();
  revalidate(locale, text(formData, 'project_id'));
  return ok('submitted');
}

/**
 * §2.4: confirm and set Quality. The Completion score is never sent from here
 * — the database derives it from the dates, so the confirmer cannot influence
 * the timeliness half of the score.
 */
export async function confirmTaskAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase.rpc('confirm_task', {
    p_task: requiredText(formData, 'task_id'),
    p_quality: requiredText(formData, 'quality'),
  });

  if (error) return fail(error.message);

  kickPushDelivery();
  revalidate(locale, text(formData, 'project_id'));
  return ok('confirmed');
}

/**
 * §2.4: back to In Progress, with no scores recorded.
 *
 * For work that came from a request, the Director also supplies a new starting
 * and delivery date here — the old ones stopped being a commitment the moment
 * the work came back.
 */
export async function rejectTaskAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase.rpc('reject_task', {
    p_task: requiredText(formData, 'task_id'),
    p_note: text(formData, 'note'),
    // Sending request-created work back needs fresh dates: the old ones are no
    // longer a commitment anybody made. Ordinary tasks ignore these.
    p_start: text(formData, 'new_start'),
    p_due: text(formData, 'new_due'),
  });

  if (error) return fail(error.message);

  kickPushDelivery();
  revalidate(locale, text(formData, 'project_id'));
  return ok('rejected');
}

/**
 * §2.5: due date passed, nothing ever submitted. Sets both scores to a literal
 * 0, and unlike a task still sitting In Progress this one counts toward
 * %Performance.
 */
export async function markNotDoneAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase.rpc('mark_task_not_done', {
    p_task: requiredText(formData, 'task_id'),
  });

  if (error) return fail(error.message);

  kickPushDelivery();
  revalidate(locale, text(formData, 'project_id'));
  return ok('markedNotDone');
}

/**
 * §7: deletion recalculates everything as though the task never existed. That
 * needs no extra work here — every KPI figure is an average computed live, so
 * removing the row removes it from the maths.
 */
export async function deleteTaskAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase.rpc('delete_task', {
    p_task: requiredText(formData, 'task_id'),
  });

  if (error) return fail(error.message);

  kickPushDelivery();
  revalidate(locale, text(formData, 'project_id'));
  return ok('deleted');
}
