'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { carriesAttendanceAndQuroosh, deliverAccountEmails, kickAccountEmails, syncGuestAccounts } from '@/lib/quroosh/accountSync';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * The managers' side of guest accounts (Quroosh 0006): read the check-ins
 * now rather than at the next sweep, and send an account its link again.
 *
 * The club database answers whether this person manages the project
 * (getQurooshAccess) before the Quroosh database is touched.
 */

const UUID = /^[0-9a-f-]{36}$/i;

async function refusal(locale: string, hint: string, message: string): Promise<ActionResult> {
  const t = await getTranslations({ locale, namespace: 'quroosh.accounts.errors' });
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

/** Makes the accounts of everyone checked in so far, and sends what is waiting. */
export async function syncAccountsAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerOf(formData);
  if ('ok' in ctx) return ctx;
  if (!(await carriesAttendanceAndQuroosh(ctx.projectId))) {
    return refusal(ctx.locale, 'needs_attendance', 'This project has no Event attendance component.');
  }
  try {
    const report = await syncGuestAccounts(ctx.projectId);
    await deliverAccountEmails();
    revalidatePath(`/${ctx.locale}/projects/${ctx.projectId}/quroosh/accounts`);
    return ok('saved', { created: String(report.created) });
  } catch (caught) {
    // A migration not applied yet is the usual reason.
    return refusal(ctx.locale, 'sync_failed', caught instanceof Error ? caught.message : 'The sync failed.');
  }
}

/** Sends an account its link again: "complete your account", or a sign-in link once it is completed. */
export async function resendAccountEmailAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerOf(formData);
  if ('ok' in ctx) return ctx;
  const accountId = text(formData, 'account_id');
  if (!accountId || !UUID.test(accountId)) return refusal(ctx.locale, 'not_found', 'This account does not exist.');

  const { data: queued, error } = await createQurooshClient().rpc('resend_account_email', {
    p_project: ctx.projectId,
    p_account: accountId,
  });
  if (error) return refusal(ctx.locale, error.hint ?? 'invalid', error.message);
  if (queued !== true) return refusal(ctx.locale, 'just_sent', 'A link was queued for this account a moment ago.');
  kickAccountEmails();
  revalidatePath(`/${ctx.locale}/projects/${ctx.projectId}/quroosh/accounts`);
  return ok();
}
