'use server';

import { getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { fail, ok, type ActionResult } from '@/lib/actions';
import {
  checkInToSession,
  cleanEmail,
  findSessionAccount,
  forgetCheckInEmail,
  getCheckInGuest,
  rememberCheckInEmail,
  sessionCheckInPath,
} from '@/lib/quroosh/sessions';

/**
 * The session check-in page's actions (Quroosh 0009, 0011): typing the email
 * on the pass, and "تسجيل حضور". Who is checking in is the signed-in guest
 * or the account of the email typed on this device (`getCheckInGuest`); the
 * page's project says which session; the Quroosh database decides whether
 * they may (once a day, on the club's calendar) and pays their wallet in the
 * same transaction.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Continue" under the email field. No link is sent: an account with this
 * email in this project is enough to rate the session and check in (the
 * club's decision, 2026-11-22). It signs nobody in.
 */
export async function enterEmailAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = String(formData.get('locale') ?? 'ar') === 'en' ? 'en' : 'ar';
  const t = await getTranslations({ locale, namespace: 'quroosh.checkin.errors' });
  const refuse = (hint: string) => fail(t.has(hint) ? t(hint) : t('invalid'), hint);

  const projectId = String(formData.get('project_id') ?? '');
  if (!UUID.test(projectId)) return refuse('invalid');
  // A field no person sees; anything in it means a bot filled the form.
  if (String(formData.get('website') ?? '') !== '') return refuse('no_account');
  const email = cleanEmail(formData.get('email'));
  if (!email) return refuse('email_invalid');

  const found = await findSessionAccount(projectId, email);
  if (found === undefined) return refuse('not_ready');
  if (!found) return refuse('no_account');
  await rememberCheckInEmail(projectId, email);
  // Outside any try: redirect() works by throwing.
  redirect({ href: sessionCheckInPath(projectId), locale });
  return ok();
}

/** "Not you?": forgets the typed email and shows the field again. */
export async function changeEmailAction(formData: FormData): Promise<void> {
  const locale = String(formData.get('locale') ?? 'ar') === 'en' ? 'en' : 'ar';
  const projectId = String(formData.get('project_id') ?? '');
  await forgetCheckInEmail();
  redirect({ href: UUID.test(projectId) ? sessionCheckInPath(projectId) : '/login', locale });
}

export async function sessionCheckInAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = String(formData.get('locale') ?? 'ar') === 'en' ? 'en' : 'ar';
  const t = await getTranslations({ locale, namespace: 'quroosh.checkin.errors' });
  const refuse = (hint: string) => fail(t.has(hint) ? t(hint) : t('invalid'), hint);

  const projectId = String(formData.get('project_id') ?? '');
  if (!UUID.test(projectId)) return refuse('invalid');
  const rating = Number(formData.get('rating'));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return refuse('rating_invalid');

  const guest = await getCheckInGuest(projectId);
  if (!guest) return refuse('signed_out');

  const result = await checkInToSession(guest.account_id, projectId, rating);
  if (!result.ok) return refuse(result.hint);
  // Outside any try: redirect() works by throwing. The page then shows what a
  // later visit today shows, with the confirmation on top.
  redirect({ href: `${sessionCheckInPath(projectId)}?done=1`, locale });
  return ok();
}
