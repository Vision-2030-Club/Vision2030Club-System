'use server';

import { text, type ActionResult } from '@/lib/actions';
import { finish, managerContext, refusal, UUID } from '@/lib/quroosh/guestActions';
import { createQurooshClient } from '@/lib/supabase/quroosh';
import { clubTimestamp } from '@/lib/time';

/**
 * The managers' side of the guest days (Quroosh 0005): add a day, change a
 * free day, turn a day off or on. Slots are never deleted.
 *
 * A slot is a day: the managers type a date only, saved through the
 * existing save_slot as that day at 00:00 Riyadh time. So the same day twice
 * is the same starts_at, which the database refuses (`slot_exists`), and a
 * day stops being offered when it begins, so guests can book it until the
 * day before.
 *
 * managerContext checks the caller manages the project before anything is
 * written. The database refuses what the rules forbid (a booked day moved or
 * turned off, the same day twice) with a hint, translated by `finish`.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The day typed, as 00:00 of that day on the club's clock (Asia/Riyadh), or null. */
function startsAt(formData: FormData): string | null {
  const day = text(formData, 'day');
  if (!day || !DAY.test(day)) return null;
  return clubTimestamp(day, '00:00');
}

export async function addSlotAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerContext(formData);
  if ('ok' in ctx) return ctx;
  const starts = startsAt(formData);
  if (!starts) return refusal(ctx.locale, 'invalid', 'Choose a day.');

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
  if (!starts) return refusal(ctx.locale, 'invalid', 'Choose a day.');

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
