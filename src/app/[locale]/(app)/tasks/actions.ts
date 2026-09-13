'use server';

import { revalidatePath } from 'next/cache';
import { kickPushDelivery } from '@/lib/push';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { all, fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { toDateInput } from '@/lib/time';

/** Dates typed into a task form are on the club's calendar; none may be behind it. */
function pastDateError(value: string | null, label: string): string | null {
  return value && value < toDateInput(new Date()) ? `${label} cannot be in the past.` : null;
}

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
 *
 * A task can be handed to more than one person (0057 E): one
 * `task_assignees` row each. The table always allowed it; the form used to
 * offer one.
 */
export async function createTaskAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const belongsTo = requiredText(formData, 'belongs_to');
  const isProject = belongsTo === 'project';
  const assignees = all(formData, 'assignee_ids');
  const dueDate = text(formData, 'due_date');
  const pastDue = pastDateError(dueDate, 'The due date');
  if (pastDue) return fail(pastDue);

  // A task with no home matches nobody's permission scope, so the database
  // refuses it as an RLS error — which is what a Project Manager saw after
  // leaving the project at "—". Say it in a sentence first.
  const projectId = isProject ? text(formData, 'project_id') : null;
  const teamId = isProject ? null : text(formData, 'team_id');
  if (isProject && !projectId) return fail('Choose the project this task belongs to.');
  if (!isProject && !teamId) return fail('Choose the team this task belongs to.');

  const me = await getMyMember();
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      title: requiredText(formData, 'title'),
      description: text(formData, 'description'),
      project_id: projectId,
      team_id: teamId,
      split_id: isProject ? text(formData, 'split_id') : null,
      due_date: dueDate,
      created_by: me?.id ?? null,
      // §3: the Assigned Date is when someone actually took the work on. A task
      // posted for claiming has none until it is claimed.
      assigned_at: assignees.length ? new Date().toISOString() : null,
    })
    .select('id, project_id')
    .single();

  if (error) return fail(error.message);

  if (assignees.length) {
    const { error: assignError } = await supabase
      .from('task_assignees')
      .insert(assignees.map((member_id) => ({ task_id: task.id, member_id })));
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
    // so, not this action. Any task may carry one, and a comment (0058).
    p_url: text(formData, 'submission_url'),
    p_note: text(formData, 'submission_note'),
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
    p_note: text(formData, 'note'),
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
  const newStart = text(formData, 'new_start');
  const newDue = text(formData, 'new_due');
  const past = pastDateError(newStart, 'The starting date') ?? pastDateError(newDue, 'The delivery date');
  if (past) return fail(past);
  const supabase = await createClient();

  const { error } = await supabase.rpc('reject_task', {
    p_task: requiredText(formData, 'task_id'),
    p_note: text(formData, 'note'),
    // Sending request-created work back needs fresh dates: the old ones are no
    // longer a commitment anybody made. Ordinary tasks ignore these.
    p_start: newStart,
    p_due: newDue,
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
 * Who holds the task, changed after the fact (0058). Whoever may administer
 * it — the same authority that confirms it — ticks the new set; rows are
 * added and removed to match, nothing else is touched. The database's
 * `task_assignees_write` is what actually decides.
 *
 * The clock follows the people: a task that had nobody and now has someone
 * starts (Assigned Date = now, §3); one that loses everyone is posted for
 * claiming again.
 */
export async function setTaskAssigneesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const taskId = requiredText(formData, 'task_id');
  const wanted = new Set(all(formData, 'assignee_ids'));
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from('task_assignees')
    .select('member_id')
    .eq('task_id', taskId);
  if (readError) return fail(readError.message);

  const have = new Set((current ?? []).map((row) => row.member_id as string));
  const remove = [...have].filter((id) => !wanted.has(id));
  const add = [...wanted].filter((id) => !have.has(id));

  if (remove.length) {
    const { error } = await supabase
      .from('task_assignees')
      .delete()
      .eq('task_id', taskId)
      .in('member_id', remove);
    if (error) return fail(error.message);
  }
  if (add.length) {
    const { error } = await supabase
      .from('task_assignees')
      .insert(add.map((member_id) => ({ task_id: taskId, member_id })));
    if (error) return fail(error.message);
  }

  if (have.size === 0 && wanted.size > 0) {
    await supabase.from('tasks').update({ assigned_at: new Date().toISOString() }).eq('id', taskId);
  } else if (have.size > 0 && wanted.size === 0) {
    await supabase.from('tasks').update({ assigned_at: null }).eq('id', taskId);
  }

  kickPushDelivery();
  revalidatePath(`/${locale}/tasks/${taskId}`);
  revalidate(locale, text(formData, 'project_id'));
  return ok();
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
