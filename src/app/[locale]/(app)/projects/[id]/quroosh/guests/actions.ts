'use server';

import { redirect } from '@/i18n/navigation';
import { text, type ActionResult } from '@/lib/actions';
import { newToken } from '@/lib/interviews/tokens';
import { finish, managerContext, refusal, UUID } from '@/lib/quroosh/guestActions';
import { createQurooshClient } from '@/lib/supabase/quroosh';

/**
 * The managers' side of guest invitations (Quroosh 0005): invite a guest
 * (speakers only, so no role is sent: the column's default is `speaker`),
 * and cancel an invitation. There is no delete.
 *
 * managerContext checks the caller manages the project before anything is
 * written, and its member id is passed as p_actor.
 */

const MAX_NAME = 200;
const MAX_NOTE = 2000;

/** Invites a guest, then opens their page, where the link and QR code are. */
export async function createInvitationAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerContext(formData);
  if ('ok' in ctx) return ctx;
  const name = text(formData, 'name');
  const note = text(formData, 'note');
  if (!name || name.length > MAX_NAME) return refusal(ctx.locale, 'name_invalid', 'Write the guest’s name.');
  if (note && note.length > MAX_NOTE) return refusal(ctx.locale, 'note_too_long', 'The note is too long.');

  const { data: invitationId, error } = await createQurooshClient().rpc('create_invitation', {
    p_project: ctx.projectId,
    p_actor: ctx.actor,
    p_token: newToken(),
    p_name: name,
    p_note: note,
  });
  // `invalid` here is the name or note failing a CHECK: say so, not the
  // slots' "choose a day and a time".
  if (error?.hint === 'invalid') return refusal(ctx.locale, 'name_invalid', error.message);
  const result = await finish(ctx, error);
  if (!result.ok || typeof invitationId !== 'string') return result;
  // Outside any try: redirect() works by throwing.
  redirect({ href: `/projects/${ctx.projectId}/quroosh/guests/${invitationId}`, locale: ctx.locale });
  return result;
}

/** Cancels an invitation: its slot is freed, and the link says it was cancelled. */
export async function cancelInvitationAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerContext(formData);
  if ('ok' in ctx) return ctx;
  const invitationId = text(formData, 'invitation_id');
  if (!invitationId || !UUID.test(invitationId)) {
    return refusal(ctx.locale, 'not_found', 'This invitation does not exist.');
  }

  const { error } = await createQurooshClient().rpc('cancel_invitation', {
    p_project: ctx.projectId,
    p_actor: ctx.actor,
    p_invitation: invitationId,
  });
  return finish(ctx, error);
}
