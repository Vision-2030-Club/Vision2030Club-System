'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { carriesAttendanceAndQuroosh, syncGuestAccounts } from '@/lib/quroosh/accountSync';
import { syncWallet } from '@/lib/quroosh/wallet';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * The managers' side of the wallet (Quroosh 0007): what a guest's first
 * visit and a session check-in are worth, and counting the check-ins again.
 *
 * The club database answers whether this person manages the project
 * (getQurooshAccess) before the Quroosh database is touched.
 */

async function refusal(locale: string, hint: string, message: string): Promise<ActionResult> {
  const t = await getTranslations({ locale, namespace: 'quroosh.wallet.errors' });
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

/**
 * Sets what a guest's first check-in at the gate pays (0010: later days pay
 * nothing) and, once 0009 is applied, what a session check-in pays. Both
 * apply from now on; entries already paid keep their amount.
 */
export async function saveWalletSettingsAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerOf(formData);
  if ('ok' in ctx) return ctx;
  const attendance = text(formData, 'attendance_points') ?? '';
  // Only on the form when 0009 is applied.
  const session = formData.has('session_points') ? (text(formData, 'session_points') ?? '') : null;
  if (!/^[0-9]{1,7}$/.test(attendance) || (session !== null && !/^[0-9]{1,7}$/.test(session))) {
    return refusal(ctx.locale, 'points_invalid', 'Enter a whole number.');
  }

  const db = createQurooshClient();
  const saved = await db.rpc('wallet_save_settings', {
    p_project: ctx.projectId,
    p_attendance_points: Number(attendance),
  });
  if (saved.error) return refusal(ctx.locale, saved.error.hint ?? 'invalid', saved.error.message);
  if (session !== null) {
    const { error } = await db.rpc('wallet_save_session_points', {
      p_project: ctx.projectId,
      p_session_points: Number(session),
    });
    if (error) return refusal(ctx.locale, error.hint ?? 'invalid', error.message);
  }
  revalidatePath(`/${ctx.locale}/projects/${ctx.projectId}/quroosh/wallet`);
  revalidatePath(`/${ctx.locale}/projects/${ctx.projectId}/event-attendance/session`);
  return ok();
}

/**
 * Reads every check-in of the event again and pays whatever is missing:
 * for after 0007 is applied mid-event, or when a number looks wrong. A
 * check-in already paid is not paid twice.
 */
export async function recountWalletAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerOf(formData);
  if ('ok' in ctx) return ctx;
  if (!(await carriesAttendanceAndQuroosh(ctx.projectId))) {
    return refusal(ctx.locale, 'needs_attendance', 'This project has no Event attendance component.');
  }
  try {
    // Accounts first: a check-in pays its attendee's account.
    await syncGuestAccounts(ctx.projectId);
    const written = await syncWallet(ctx.projectId, { fromStart: true });
    revalidatePath(`/${ctx.locale}/projects/${ctx.projectId}/quroosh/wallet`);
    return ok('saved', { written: String(written) });
  } catch (caught) {
    return refusal(ctx.locale, 'sync_failed', caught instanceof Error ? caught.message : 'The recount failed.');
  }
}
