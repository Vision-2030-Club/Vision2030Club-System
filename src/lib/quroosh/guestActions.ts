import 'server-only';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { fail, fromPostgrest, requiredText, type ActionResult } from '@/lib/actions';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * What every managers' action on guests (Quroosh 0005) starts and ends with.
 *
 * The club database answers whether this person manages the project
 * (getQurooshAccess); only then is the Quroosh database written, with their
 * member id as p_actor. The database refuses what its rules forbid with a
 * hint, translated here from `quroosh.guests.errors`.
 */

export const UUID = /^[0-9a-f-]{36}$/i;

export type GuestContext = { projectId: string; locale: string; actor: string };

/** A refusal in the manager's language, the database's message as the fallback. */
export async function refusal(locale: string, hint: string, message: string): Promise<ActionResult> {
  const t = await getTranslations({ locale, namespace: 'quroosh.guests.errors' });
  return fail(t.has(hint) ? t(hint) : message, hint);
}

/** The form's project and language, once the caller is known to manage it; else the refusal. */
export async function managerContext(formData: FormData): Promise<GuestContext | ActionResult> {
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

/** The database's answer, its refusal translated; the guests pages refreshed on success. */
export async function finish(ctx: GuestContext, error: Parameters<typeof fromPostgrest>[0]): Promise<ActionResult> {
  const result = fromPostgrest(error);
  if (!result.ok) return result.hint ? refusal(ctx.locale, result.hint, result.error ?? '') : result;
  revalidatePath(`/${ctx.locale}/projects/${ctx.projectId}/quroosh/guests`, 'layout');
  return result;
}
