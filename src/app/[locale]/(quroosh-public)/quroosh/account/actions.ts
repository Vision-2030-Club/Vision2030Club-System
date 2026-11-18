'use server';

import { getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { fail, ok, type ActionResult } from '@/lib/actions';
import { accountHomePath, endGuestSession, redeemAccountLink } from '@/lib/quroosh/accounts';
import { kickAccountEmails } from '@/lib/quroosh/accountSync';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * What a guest does about their own account (Quroosh 0006), without being a
 * club member: use a one-time link, ask for a sign-in link, sign out.
 *
 * Each is called by this server with the Quroosh database's secret key. The
 * link's token and the session cookie are the only proof of who is asking,
 * and the database checks both.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function localeOf(formData: FormData): 'ar' | 'en' {
  return String(formData.get('locale') ?? 'ar') === 'en' ? 'en' : 'ar';
}

async function refusal(locale: string, hint: string): Promise<ActionResult> {
  const t = await getTranslations({ locale, namespace: 'quroosh.account.errors' });
  return fail(t.has(hint) ? t(hint) : t('invalid'), hint);
}

/**
 * The button on a link's page. The first press of a "complete your account"
 * link creates the account; either kind signs this device in. Then the
 * guest's account page opens.
 */
export async function redeemLinkAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = localeOf(formData);
  const result = await redeemAccountLink(String(formData.get('token') ?? ''));
  if (!result.ok) return refusal(locale, result.hint);
  // Outside any try: redirect() works by throwing.
  redirect({
    href: `${accountHomePath(result.projectId)}${result.newlyCompleted ? '?created=1' : ''}`,
    locale,
  });
  return ok();
}

/**
 * "Send me a sign-in link." The answer is the same whether or not the email
 * has an account, so the form cannot be used to learn who is registered.
 */
export async function requestSignInAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = localeOf(formData);
  // A field no person sees; anything in it means a bot filled the form.
  if (String(formData.get('website') ?? '') !== '') return ok('sent');

  const projectId = String(formData.get('project_id') ?? '');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return refusal(locale, 'email_invalid');
  if (!UUID.test(projectId) || !isQurooshConfigured()) return ok('sent');

  // An error here (0006 not applied) reads the same as "no such account".
  await createQurooshClient().rpc('request_account_signin', { p_project: projectId, p_email: email });
  kickAccountEmails();
  return ok('sent');
}

/** Signs this device out, and shows the sign-in page again. */
export async function signOutAction(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  const projectId = String(formData.get('project_id') ?? '');
  await endGuestSession();
  redirect({ href: UUID.test(projectId) ? accountHomePath(projectId) : '/login', locale });
}
