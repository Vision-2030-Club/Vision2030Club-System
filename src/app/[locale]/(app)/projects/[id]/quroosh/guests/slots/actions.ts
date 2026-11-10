'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { fail, fromPostgrest, requiredText, text, type ActionResult } from '@/lib/actions';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { clubTimestamp } from '@/lib/time';

/**
 * The managers' side of the guest slots (Quroosh 0005): add a slot, change
 * a free slot's time, turn a slot off or on. Slots are never deleted.
 *
 * The club database answers whether this person manages the project
 * (getQurooshAccess); only then is the Quroosh database written, recording
 * who. The database refuses what the rules forbid (a booked slot moved or
 * turned off, the same time twice) with a hint, translated here.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}/;
const UUID = /^[0-9a-f-]{36}$/i;

type Context = { projectId: string; locale: string; actor: string };

async function refusal(locale: string, hint: string, message: string): Promise<ActionResult> {
  const t = await getTranslations({ locale, namespace: 'quroosh.guests.errors' });
  return fail(t.has(hint) ? t(hint) : message, hint);
}

async function context(formData: FormData): Promise<Context | ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const access = await getQurooshAccess(projectId);
  if (!access || !can.manage(access.role)) {
    return refusal(locale, 'forbidden', 'Only the project’s managers can change this.');
  }
  if (!isQurooshConfigured()) {
    return refusal(locale, 'not_configured', 'The Quroosh database is not configured on this deployment.');
  }
  return { projectId, locale, actor: access.me.id };
}

/** The database's answer, its refusal translated; the page refreshed on success. */
async function done(ctx: Context, error: Parameters<typeof fromPostgrest>[0]): Promise<ActionResult> {
  const result = fromPostgrest(error);
  if (!result.ok) return result.hint ? refusal(ctx.locale, result.hint, result.error ?? '') : result;
  revalidatePath(`/${ctx.locale}/projects/${ctx.projectId}/quroosh/guests`, 'layout');
  return result;
}

/** The day and time typed, as an instant on the club's clock (Asia/Riyadh), or null. */
function startsAt(formData: FormData): string | null {
  const day = text(formData, 'day');
  const time = text(formData, 'time');
  if (!day || !time || !DAY.test(day) || !TIME.test(time)) return null;
  return clubTimestamp(day, time.slice(0, 5));
}

export async function addSlotAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await context(formData);
  if ('ok' in ctx) return ctx;
  const starts = startsAt(formData);
  if (!starts) return refusal(ctx.locale, 'invalid', 'Choose a day and a time.');

  const { error } = await createQurooshClient().rpc('save_slot', {
    p_project: ctx.projectId,
    p_actor: ctx.actor,
    p_slot: null,
    p_starts_at: starts,
  });
  return done(ctx, error);
}

export async function editSlotAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await context(formData);
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
  return done(ctx, error);
}

export async function setSlotActiveAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await context(formData);
  if ('ok' in ctx) return ctx;
  const slotId = text(formData, 'slot_id');
  if (!slotId || !UUID.test(slotId)) return refusal(ctx.locale, 'not_found', 'This slot does not exist.');

  const { error } = await createQurooshClient().rpc('set_slot_active', {
    p_project: ctx.projectId,
    p_actor: ctx.actor,
    p_slot: slotId,
    p_active: formData.get('active') === 'true',
  });
  return done(ctx, error);
}
