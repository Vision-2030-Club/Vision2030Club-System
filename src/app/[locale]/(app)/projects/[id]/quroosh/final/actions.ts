'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { accountHomePath } from '@/lib/quroosh/accounts';
import { FINAL_STATUSES, type FinalStatus } from '@/lib/quroosh/final';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * The managers' side of the Final Wave (Quroosh 0014): show it to guests,
 * open and close giving, and list the projects on stage (add, rewrite, hide).
 *
 * The club database answers whether this person manages the project
 * (getQurooshAccess) before the Quroosh database is touched, and every
 * function is given the project so one project cannot reach another's.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function refusal(locale: string, hint: string, message: string): Promise<ActionResult> {
  const t = await getTranslations({ locale, namespace: 'quroosh.final.errors' });
  return fail(t.has(hint) ? t(hint) : message, hint);
}

async function managerOf(formData: FormData): Promise<{ projectId: string; locale: string } | ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const access = await getQurooshAccess(projectId);
  if (!access || !can.manage(access.role)) {
    return refusal(locale, 'forbidden', 'Only the project’s managers can do this.');
  }
  if (!isQurooshConfigured()) return refusal(locale, 'not_configured', 'The Quroosh database is not configured.');
  return { projectId, locale };
}

/** The managers' page and the guests' page both follow every change. */
function refresh(ctx: { projectId: string; locale: string }) {
  revalidatePath(`/${ctx.locale}/projects/${ctx.projectId}/quroosh/final`);
  // Guests read in either language, whatever the manager's.
  for (const locale of ['ar', 'en']) revalidatePath(`/${locale}${accountHomePath(ctx.projectId)}`, 'layout');
}

/** Hidden, open for giving, or closed with the results showing. */
export async function saveFinalStatusAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerOf(formData);
  if ('ok' in ctx) return ctx;
  const status = text(formData, 'status') ?? '';
  if (!(FINAL_STATUSES as readonly string[]).includes(status)) {
    return refusal(ctx.locale, 'status_invalid', 'Choose hidden, open or closed.');
  }
  const { error } = await createQurooshClient().rpc('final_save_status', {
    p_project: ctx.projectId,
    p_status: status as FinalStatus,
  });
  if (error) return refusal(ctx.locale, error.hint ?? 'invalid', error.message);
  refresh(ctx);
  return ok();
}

/** Adds a project to the end of the list, or rewrites one's name and brief. */
export async function saveFinalProjectAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerOf(formData);
  if ('ok' in ctx) return ctx;
  const id = text(formData, 'final_project_id');
  const name = text(formData, 'name');
  const brief = text(formData, 'brief');
  if (id && !UUID.test(id)) return refusal(ctx.locale, 'not_found', 'This project is not on the list.');
  if (!name || name.length > 120) return refusal(ctx.locale, 'name_invalid', 'Write the project’s name.');
  if (brief && brief.length > 1000) return refusal(ctx.locale, 'brief_invalid', 'The brief is too long.');

  const { error } = await createQurooshClient().rpc('final_project_save', {
    p_project: ctx.projectId,
    p_id: id || null,
    p_name: name,
    p_brief: brief,
  });
  if (error) return refusal(ctx.locale, error.hint ?? 'invalid', error.message);
  refresh(ctx);
  return ok();
}

/** Takes a project off the guests' list, or puts it back. What it collected stays. */
export async function hideFinalProjectAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerOf(formData);
  if ('ok' in ctx) return ctx;
  const id = text(formData, 'final_project_id') ?? '';
  if (!UUID.test(id)) return refusal(ctx.locale, 'not_found', 'This project is not on the list.');
  const { error } = await createQurooshClient().rpc('final_project_hide', {
    p_project: ctx.projectId,
    p_id: id,
    p_hidden: formData.get('hidden') === 'true',
  });
  if (error) return refusal(ctx.locale, error.hint ?? 'invalid', error.message);
  refresh(ctx);
  return ok();
}
