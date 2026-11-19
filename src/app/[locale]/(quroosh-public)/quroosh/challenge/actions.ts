'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { fail, ok, type ActionResult } from '@/lib/actions';
import { getGuestAccount } from '@/lib/quroosh/accounts';
import { getChallengeByToken } from '@/lib/quroosh/challenges';
import { createQurooshClient } from '@/lib/supabase/quroosh';

/**
 * What a guest does in a booth's challenge (Quroosh 0008): start it, and
 * answer the question they are on.
 *
 * The session cookie says who is playing and the booth's code says which
 * challenge; the Quroosh database decides everything else, on its own clock:
 * whether they may start, which question they are on, how long they took
 * and what it paid.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function localeOf(formData: FormData): 'ar' | 'en' {
  return String(formData.get('locale') ?? 'ar') === 'en' ? 'en' : 'ar';
}

/** The signed-in guest and the challenge of the form's code, when they belong together. */
async function playerOf(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const [account, challenge] = await Promise.all([getGuestAccount(), getChallengeByToken(token)]);
  if (!account || !challenge || account.project_id !== challenge.project_id) return null;
  return { account, challenge, token };
}

/** Starts the guest's one attempt; the first question's clock starts with it. */
export async function startChallengeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = localeOf(formData);
  const t = await getTranslations({ locale, namespace: 'quroosh.challenge.errors' });
  const player = await playerOf(formData);
  if (!player) return fail(t('forbidden'), 'forbidden');

  const { error } = await createQurooshClient().rpc('challenge_start', {
    p_account: player.account.account_id,
    p_challenge: player.challenge.id,
  });
  if (error) {
    const hint = error.hint && /^[a-z_]+$/.test(error.hint) ? error.hint : 'invalid';
    return fail(t.has(hint) ? t(hint) : t('invalid'), hint);
  }
  revalidatePath(`/${locale}/quroosh/challenge/${player.token}`);
  return ok();
}

/**
 * Answers the question the guest is on, or records that its time ran out
 * (no choice). The page then shows the next question, or the result. An
 * answer the database does not want (a second press, an old tab) changes
 * nothing, so there is nothing to report back.
 */
export async function answerChallengeAction(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  const player = await playerOf(formData);
  const questionId = String(formData.get('question_id') ?? '');
  if (!player || !UUID.test(questionId)) return;

  const raw = formData.get('choice');
  const choice = typeof raw === 'string' && /^[0-3]$/.test(raw) ? Number(raw) : null;
  await createQurooshClient().rpc('challenge_answer', {
    p_account: player.account.account_id,
    p_challenge: player.challenge.id,
    p_question: questionId,
    p_choice: choice,
  });
  revalidatePath(`/${locale}/quroosh/challenge/${player.token}`);
}
