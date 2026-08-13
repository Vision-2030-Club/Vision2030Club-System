'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import type { RequestField } from '@/lib/requests';

/**
 * Creating a request of ANY type goes through this one action. It reads the
 * type's `field_schema` and collects exactly those fields — which is why
 * adding a new request type needs no new code here (spec §3).
 */
export async function createRequestAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const typeId = requiredText(formData, 'request_type_id');
  const me = await getMyMember();
  const supabase = await createClient();

  const { data: type, error: typeError } = await supabase
    .from('request_types')
    .select('id, key, owning_team_id, field_schema')
    .eq('id', typeId)
    .maybeSingle();

  if (typeError || !type) return fail(typeError?.message ?? 'Unknown request type');

  // The starting status is configuration too, not a constant in the code.
  const { data: initial } = await supabase
    .from('request_statuses')
    .select('key')
    .eq('request_type_id', typeId)
    .eq('is_initial', true)
    .maybeSingle();

  if (!initial) return fail('This request type has no initial status configured.');

  const data: Record<string, string | number> = {};
  for (const field of (type.field_schema ?? []) as RequestField[]) {
    const raw = text(formData, `field_${field.key}`);
    if (raw === null) {
      if (field.required) {
        return fail(`Missing required field: ${field.label_en}`);
      }
      continue;
    }
    if (field.type === 'number') {
      data[field.key] = Number(raw);
    } else if (field.type === 'datetime') {
      // `datetime-local` has no timezone; anchor it to the browser's before
      // storing so the calendar shows the time that was actually meant.
      data[field.key] = new Date(raw).toISOString();
    } else {
      data[field.key] = raw;
    }
  }

  // Where the request is routed. Team-owned types go to their owning team;
  // meeting requests let the requester choose.
  let targetKind = text(formData, 'target_kind') ?? 'team';
  let targetTeam: string | null = text(formData, 'target_team_id');
  let targetProject: string | null = text(formData, 'target_project_id');

  if (type.owning_team_id) {
    targetKind = 'team';
    targetTeam = type.owning_team_id as string;
    targetProject = null;
  }

  if (targetKind === 'team' && !targetTeam) return fail('Choose a team to send this to.');
  if (targetKind === 'project' && !targetProject) return fail('Choose a project to send this to.');
  if (targetKind === 'presidency') {
    targetTeam = null;
    targetProject = null;
  }
  if (targetKind === 'team') targetProject = null;
  if (targetKind === 'project') targetTeam = null;

  const { data: created, error } = await supabase
    .from('requests')
    .insert({
      request_type_id: typeId,
      submitted_by: me!.id,
      target_kind: targetKind,
      target_team_id: targetTeam,
      target_project_id: targetProject,
      status: initial.key,
      data,
    })
    .select('id')
    .single();

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/requests`);
  revalidatePath(`/${locale}/requests/${created.id}`);
  return ok('created');
}

/**
 * Move a request along its configured flow.
 *
 * This action does NOT decide whether the move is allowed. It calls the
 * `transition_request` function, which runs as the caller: the RLS policy
 * decides whether they may touch the request at all, and the validate trigger
 * checks the (from, to) pair against `request_transitions` and the actor rule.
 * An illegal move comes back as a real error, never a silent no-op.
 */
export async function transitionRequestAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const requestId = requiredText(formData, 'request_id');
  const toStatus = requiredText(formData, 'to_status');
  const supabase = await createClient();

  // Counter-offers carry a new proposed time; everything else sends nothing.
  const patch: Record<string, string> = {};
  const proposedStart = text(formData, 'proposed_start');
  const proposedEnd = text(formData, 'proposed_end');
  if (proposedStart) patch.proposed_start = new Date(proposedStart).toISOString();
  if (proposedEnd) patch.proposed_end = new Date(proposedEnd).toISOString();

  const { error } = await supabase.rpc('transition_request', {
    p_request: requestId,
    p_to_status: toStatus,
    p_note: text(formData, 'note'),
    p_patch: patch,
  });

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/requests`);
  revalidatePath(`/${locale}/requests/${requestId}`);
  revalidatePath(`/${locale}/calendar`);
  return ok('transitioned');
}
