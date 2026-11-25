'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { fail, ok, type ActionResult } from '@/lib/actions';
import { accountHomePath, getGuestAccount } from '@/lib/quroosh/accounts';
import { FINAL_STEP } from '@/lib/quroosh/final';
import { createQurooshClient } from '@/lib/supabase/quroosh';

/**
 * A guest gives a Final Wave project quroosh from their wallet (Quroosh 0014).
 *
 * The session cookie says who is giving; the Quroosh database decides the
 * rest under a lock on the account: whether giving is open, the steps of
 * 250, and whether the balance covers it. The gift and its ledger entry are
 * written together.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function giveFinalAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = String(formData.get('locale') ?? 'ar') === 'en' ? 'en' : 'ar';
  const t = await getTranslations({ locale, namespace: 'quroosh.account.final.errors' });
  const refuse = (hint: string) => fail(t.has(hint) ? t(hint) : t('invalid'), hint);

  const projectId = String(formData.get('project_id') ?? '');
  const finalProjectId = String(formData.get('final_project_id') ?? '');
  const raw = String(formData.get('amount') ?? '');
  if (!UUID.test(projectId) || !UUID.test(finalProjectId)) return refuse('project_not_found');
  const amount = /^[0-9]{1,8}$/.test(raw) ? Number(raw) : 0;
  if (amount <= 0 || amount % FINAL_STEP !== 0) return refuse('amount_invalid');

  // Only the signed-in guest of this project; never the session check-in's email.
  const account = await getGuestAccount();
  if (!account || account.project_id !== projectId) return refuse('forbidden');

  const { data, error } = await createQurooshClient().rpc('final_give', {
    p_account: account.account_id,
    p_project: projectId,
    p_final_project: finalProjectId,
    p_amount: amount,
  });
  if (error) {
    return refuse(error.hint && /^[a-z_]+$/.test(error.hint) ? error.hint : 'invalid');
  }

  const home = accountHomePath(projectId);
  revalidatePath(`/${locale}${home}/final`);
  revalidatePath(`/${locale}${home}`);
  return ok('saved', { amount: String(amount), balance: String(Number(data ?? 0)) });
}
