'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, hasPermission } from '@/lib/auth/session';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import {
  MAX_REQUEST_FILE_BYTES,
  REQUEST_FILE_BUCKET,
  fieldApplies,
  type RequestField,
} from '@/lib/requests';
import { fromClubWallClock, toDateInput } from '@/lib/time';
import { ensureMeetLink } from '@/lib/google/meetings';
import { kickPushDelivery } from '@/lib/push';

/**
 * The authority behind a field's `min` (RequestFields.tsx sets the hint).
 * Checked on the club's clock: the testers proposed meetings in 2013, and a
 * browser's clock is trivial to move back.
 */
function pastFieldError(field: RequestField, raw: string): string | null {
  if (!field.no_past) return null;
  if (field.type === 'datetime' && fromClubWallClock(raw).getTime() < Date.now()) {
    return `${field.label_en} cannot be in the past.`;
  }
  if (field.type === 'date' && raw < toDateInput(new Date())) {
    return `${field.label_en} cannot be in the past.`;
  }
  return null;
}

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
    .select('id, key, owning_team_id, field_schema, submit_permission')
    .eq('id', typeId)
    .maybeSingle();

  if (typeError || !type) return fail(typeError?.message ?? 'Unknown request type');

  /*
   * §7 asks for this at BOTH layers. `requests_insert` refuses it in the
   * database, so calling the API directly gets a real permission error — this
   * check exists only to say so in a sentence rather than as a policy
   * violation. Which permission (if any) is configuration on the type.
   */
  if (type.submit_permission && !(await hasPermission(type.submit_permission as string))) {
    return fail(`Permission denied: ${type.submit_permission}`);
  }

  // The starting status is configuration too, not a constant in the code.
  const { data: initial } = await supabase
    .from('request_statuses')
    .select('key')
    .eq('request_type_id', typeId)
    .eq('is_initial', true)
    .maybeSingle();

  if (!initial) return fail('This request type has no initial status configured.');

  const data: Record<string, string | number> = {};
  const fields = (type.field_schema ?? []) as RequestField[];
  // What was answered, before typing: `show_when` reads it to decide which
  // questions were asked at all, so a hidden required field is not demanded.
  const answered = Object.fromEntries(fields.map((f) => [f.key, text(formData, `field_${f.key}`)]));

  for (const field of fields) {
    if (!fieldApplies(field, answered)) continue;

    const raw = answered[field.key];
    if (raw === null) {
      if (field.required) {
        return fail(`Missing required field: ${field.label_en}`);
      }
      continue;
    }
    const pastError = pastFieldError(field, raw);
    if (pastError) return fail(pastError);

    if (field.type === 'number') {
      data[field.key] = Number(raw);
    } else if (field.type === 'datetime') {
      // `datetime-local` carries no timezone. Anchor it to the CLUB's clock —
      // `new Date(raw)` would use the server's, which is UTC in production and
      // Riyadh on a laptop, so the same form would store two different times.
      data[field.key] = fromClubWallClock(raw).toISOString();
    } else {
      data[field.key] = raw;
    }
  }

  // Where the request is routed. Team-owned types go to their owning team;
  // meeting requests let the requester choose.
  let targetKind = text(formData, 'target_kind') ?? 'team';
  let targetTeam: string | null = text(formData, 'target_team_id');
  let targetProject: string | null = text(formData, 'target_project_id');
  let targetMember: string | null = text(formData, 'target_member_id');

  if (type.owning_team_id) {
    targetKind = 'team';
    targetTeam = type.owning_team_id as string;
    targetProject = null;
    targetMember = null;
  }

  if (targetKind === 'team' && !targetTeam) return fail('Choose a team to send this to.');
  if (targetKind === 'project' && !targetProject) return fail('Choose a project to send this to.');
  // §2: a meeting can be with one specific person.
  if (targetKind === 'individual' && !targetMember) {
    return fail('Choose the person to send this to.');
  }

  // `requests_target_shape` allows exactly one target column to be set, so
  // clear the others rather than relying on the form never sending them.
  if (targetKind !== 'team') targetTeam = null;
  if (targetKind !== 'project') targetProject = null;
  if (targetKind !== 'individual') targetMember = null;

  const { data: created, error } = await supabase
    .from('requests')
    .insert({
      request_type_id: typeId,
      submitted_by: me!.id,
      target_kind: targetKind,
      target_team_id: targetTeam,
      target_project_id: targetProject,
      target_member_id: targetMember,
      status: initial.key,
      data,
    })
    .select('id')
    .single();

  if (error) return fail(error.message);

  // The insert trigger queued a push for whoever can act on it (0049).
  kickPushDelivery();

  revalidatePath(`/${locale}/requests`);
  revalidatePath(`/${locale}/requests/${created.id}`);
  revalidatePath(`/${locale}/dashboard`);
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

  /*
   * Whatever THIS move asks for (0033). Previously this collected
   * `proposed_start` and `proposed_end` by name, which meant the shared
   * transition path knew what a meeting was. Now it reads the transition's own
   * `field_schema` and collects exactly that — so a counter-offer can also
   * change the room and the format, and a Design Request can collect its
   * dates, without either being mentioned here.
   */
  const { data: request } = await supabase
    .from('requests')
    .select('request_type_id, status')
    .eq('id', requestId)
    .maybeSingle();

  if (!request) return fail('That request no longer exists.');

  const { data: transition } = await supabase
    .from('request_transitions')
    .select('field_schema')
    .eq('request_type_id', request.request_type_id as string)
    .eq('from_status', request.status as string)
    .eq('to_status', toStatus)
    .maybeSingle();

  const patch: Record<string, string | number> = {};
  const fields = (transition?.field_schema ?? []) as RequestField[];
  // Same rule as the create path: a question that was not asked (its
  // `show_when` did not hold) is neither read nor required.
  const answered = Object.fromEntries(fields.map((f) => [f.key, text(formData, `field_${f.key}`)]));

  for (const field of fields) {
    if (!fieldApplies(field, answered)) continue;

    /*
     * A `file` answer is an upload, not a value. It goes to the private
     * `design-files` bucket under the request's own id — which is the same
     * string the bucket policy checks, so a file is exactly as visible as the
     * request that delivered it — and what lands in `data` is the path.
     */
    if (field.type === 'file') {
      const file = formData.get(`field_${field.key}`);
      if (!(file instanceof File) || file.size === 0) {
        if (field.required) return fail(`Missing required field: ${field.label_en}`);
        continue;
      }
      if (file.size > MAX_REQUEST_FILE_BYTES) {
        return fail('That file is over 10 MB. Share a link to it instead.');
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      const path = `${requestId}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from(REQUEST_FILE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

      if (uploadError) return fail(uploadError.message);
      patch[field.key] = path;
      continue;
    }

    const raw = text(formData, `field_${field.key}`);
    if (raw === null) {
      if (field.required) {
        return fail(`Missing required field: ${field.label_en}`);
      }
      continue;
    }
    const pastError = pastFieldError(field, raw);
    if (pastError) return fail(pastError);

    if (field.type === 'number') {
      patch[field.key] = Number(raw);
    } else if (field.type === 'datetime') {
      // The club's clock, for the same reason as the create path.
      patch[field.key] = fromClubWallClock(raw).toISOString();
    } else {
      patch[field.key] = raw;
    }
  }

  const { error } = await supabase.rpc('transition_request', {
    p_request: requestId,
    p_to_status: toStatus,
    p_note: text(formData, 'note'),
    p_patch: patch,
  });

  if (error) return fail(error.message);

  /*
   * §3: the moment a meeting is confirmed, its Meet link is created — no
   * manual step. The database cannot do it (a trigger making a network call
   * would hold the transaction open and turn a Google outage into "you cannot
   * confirm your meeting"), so it happens here, after the transition has
   * committed.
   *
   * Deliberately NOT awaited: the meeting IS agreed and IS on the club's own
   * calendar whatever Google says. Awaiting it made every approve button wait
   * on an OAuth refresh plus a Calendar insert — two external round trips —
   * before the page could update. A failure is recorded on the row, shown on
   * this page, and retried from Admin → Google.
   */
  void ensureMeetLink(requestId).catch((error) => {
    console.error('[meet] link creation failed for', requestId, error);
  });

  // Same shape, same reason: the transition trigger queued the pushes, and
  // the page should not wait on Apple to send them.
  kickPushDelivery();

  revalidatePath(`/${locale}/requests`);
  revalidatePath(`/${locale}/requests/${requestId}`);
  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/rooms`);
  // A confirmed meeting changes "coming up"; any move changes "my requests".
  // Without this the dashboard only caught up when its 30s cache expired,
  // which read as the box changing for no reason.
  revalidatePath(`/${locale}/dashboard`);
  return ok('transitioned');
}
