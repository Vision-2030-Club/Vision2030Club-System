'use server';

import { getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { text, type ActionResult } from '@/lib/actions';
import { newToken } from '@/lib/interviews/tokens';
import { finish, managerContext, refusal, UUID } from '@/lib/quroosh/guestActions';
import { isGuestTitle, MAX_CUSTOM_TITLE } from '@/lib/quroosh/guestTitles';
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

/**
 * The title chosen on the form, as written before the name (in the form's
 * language, from `quroosh.guests.new.titles`), '' for none, or null when the
 * choice is missing or a custom title is too long. "Other" with its field
 * left empty is no title, the same as "No title".
 */
async function chosenTitle(formData: FormData, locale: string): Promise<string | null> {
  const key = text(formData, 'title') ?? '';
  if (!isGuestTitle(key)) return null;
  if (key === 'none') return '';
  if (key === 'other') {
    const custom = text(formData, 'title_custom') ?? '';
    return custom.length <= MAX_CUSTOM_TITLE ? custom : null;
  }
  const t = await getTranslations({ locale, namespace: 'quroosh.guests.new.titles' });
  return t(`${key}.text`);
}

/**
 * Invites a guest, then opens their page, where the link and QR code are.
 * There is no title column: the chosen title goes in front of the name with
 * a space, and that is saved as the name, shown exactly so on the invitation.
 */
export async function createInvitationAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerContext(formData);
  if ('ok' in ctx) return ctx;
  const title = await chosenTitle(formData, ctx.locale);
  if (title === null) return refusal(ctx.locale, 'title_missing', 'Choose a title, or write one.');
  const typed = text(formData, 'name');
  const note = text(formData, 'note');
  if (!typed) return refusal(ctx.locale, 'name_invalid', 'Write the guest’s name.');
  const name = title ? `${title} ${typed}` : typed;
  if (name.length > MAX_NAME) return refusal(ctx.locale, 'name_invalid', 'The title and name are too long.');
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

/**
 * Moves a guest's booking to another free slot (`move_booking`). Two people
 * taking the same slot race on its unique index; the second gets
 * `slot_taken`. Guests cannot change their own booking; managers can.
 */
export async function moveBookingAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerContext(formData);
  if ('ok' in ctx) return ctx;
  const invitationId = text(formData, 'invitation_id');
  const slotId = text(formData, 'slot_id');
  if (!invitationId || !UUID.test(invitationId)) return refusal(ctx.locale, 'not_found', 'This invitation does not exist.');
  if (!slotId || !UUID.test(slotId)) return refusal(ctx.locale, 'slot_missing', 'Choose a time.');

  const { error } = await createQurooshClient().rpc('move_booking', {
    p_project: ctx.projectId,
    p_actor: ctx.actor,
    p_invitation: invitationId,
    p_slot: slotId,
  });
  return finish(ctx, error);
}

/**
 * Cancels a guest's booking but not their invitation (`cancel_booking`): the
 * slot is free again, and their link offers the free times again.
 */
export async function cancelBookingAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerContext(formData);
  if ('ok' in ctx) return ctx;
  const invitationId = text(formData, 'invitation_id');
  if (!invitationId || !UUID.test(invitationId)) return refusal(ctx.locale, 'not_found', 'This invitation does not exist.');

  const { error } = await createQurooshClient().rpc('cancel_booking', {
    p_project: ctx.projectId,
    p_actor: ctx.actor,
    p_invitation: invitationId,
  });
  return finish(ctx, error);
}
