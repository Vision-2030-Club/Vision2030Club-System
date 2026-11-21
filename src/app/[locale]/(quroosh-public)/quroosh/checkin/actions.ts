'use server';

import { getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { fail, ok, type ActionResult } from '@/lib/actions';
import { getGuestAccount } from '@/lib/quroosh/accounts';
import { checkInToSession, sessionCheckInPath } from '@/lib/quroosh/sessions';

/**
 * "تسجيل حضور" on the session check-in page (Quroosh 0009). The session
 * cookie says who is checking in and the page's project which session; the
 * Quroosh database decides whether they may (once a day, on the club's
 * calendar) and pays their wallet in the same transaction.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sessionCheckInAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = String(formData.get('locale') ?? 'ar') === 'en' ? 'en' : 'ar';
  const t = await getTranslations({ locale, namespace: 'quroosh.checkin.errors' });
  const refuse = (hint: string) => fail(t.has(hint) ? t(hint) : t('invalid'), hint);

  const projectId = String(formData.get('project_id') ?? '');
  if (!UUID.test(projectId)) return refuse('invalid');
  const rating = Number(formData.get('rating'));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return refuse('rating_invalid');

  const account = await getGuestAccount();
  // A session of another project's account is nobody here.
  if (!account || account.project_id !== projectId) return refuse('signed_out');

  const result = await checkInToSession(account.account_id, projectId, rating);
  if (!result.ok) return refuse(result.hint);
  // Outside any try: redirect() works by throwing. The page then shows what a
  // later visit today shows, with the confirmation on top.
  redirect({ href: `${sessionCheckInPath(projectId)}?done=1`, locale });
  return ok();
}
