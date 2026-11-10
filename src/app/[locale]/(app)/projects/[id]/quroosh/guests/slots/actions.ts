'use server';

import { text, type ActionResult } from '@/lib/actions';
import { finish, managerContext, refusal, UUID } from '@/lib/quroosh/guestActions';
import { createQurooshClient } from '@/lib/supabase/quroosh';
import { clubTimestamp } from '@/lib/time';

/**
 * The managers' side of the guest slots (Quroosh 0005): add a slot, change
 * a free slot's time, turn a slot off or on. Slots are never deleted.
 *
 * managerContext checks the caller manages the project before anything is
 * written. The database refuses what the rules forbid (a booked slot moved or
 * turned off, the same time twice) with a hint, translated by `finish`.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}/;

/** The day and time typed, as an instant on the club's clock (Asia/Riyadh), or null. */
function startsAt(formData: FormData): string | null {
  const day = text(formData, 'day');
  const time = text(formData, 'time');
  if (!day || !time || !DAY.test(day) || !TIME.test(time)) return null;
  return clubTimestamp(day, time.slice(0, 5));
}

export async function addSlotAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerContext(formData);
  if ('ok' in ctx) return ctx;
  const starts = startsAt(formData);
  if (!starts) return refusal(ctx.locale, 'invalid', 'Choose a day and a time.');

  const { error } = await createQurooshClient().rpc('save_slot', {
    p_project: ctx.projectId,
    p_actor: ctx.actor,
    p_slot: null,
    p_starts_at: starts,
  });
  return finish(ctx, error);
}

export async function editSlotAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerContext(formData);
  if ('ok' in ctx) return ctx;
  const slotId = text(formData, 'slot_id');
  if (!slotId || !UUID.test(slotId)) return refusal(ctx.locale, 'not_found', 'This slot does not exist.');
  const starts = startsAt(formData);
  if (!starts) return refusal(ctx.locale, 'invalid', 'Choose a day and a time.');

  const { error } = await createQurooshClient().rpc('save_slot', {
    p_project: ctx.projectId,
    p_actor: ctx.actor,
    p_slot: slotId,
    p_starts_at: starts,
  });
  return finish(ctx, error);
}

export async function setSlotActiveAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerContext(formData);
  if ('ok' in ctx) return ctx;
  const slotId = text(formData, 'slot_id');
  if (!slotId || !UUID.test(slotId)) return refusal(ctx.locale, 'not_found', 'This slot does not exist.');

  const { error } = await createQurooshClient().rpc('set_slot_active', {
    p_project: ctx.projectId,
    p_actor: ctx.actor,
    p_slot: slotId,
    p_active: formData.get('active') === 'true',
  });
  return finish(ctx, error);
}
