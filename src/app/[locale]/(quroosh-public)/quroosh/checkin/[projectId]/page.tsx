import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Button, Card } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { accountHomePath, getGuestAccount } from '@/lib/quroosh/accounts';
import { getSessionPoints, getSessionToday, sessionCheckInPath } from '@/lib/quroosh/sessions';
import { formatQuroosh } from '@/lib/quroosh/wallet';
import { SignInForm } from '../../account/SignInForm';
import { RatingForm, StarsShown } from './RatingForm';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LINK_BUTTON =
  'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-muted';

/**
 * The dialogue session's check-in: /quroosh/checkin/<club project id>
 * (Quroosh 0009). What the organizers' QR code opens. One page, three faces:
 *
 *   nobody signed in        sign in first; the emailed link brings them back here
 *   not checked in today    rate the session (1 to 5 stars), then "تسجيل حضور"
 *   checked in today        "already checked in", the button disabled until
 *                           00:00 Riyadh; with ?done=1, the confirmation on top
 *
 * Which face is decided by the Quroosh database each time the page is read,
 * on the club's calendar, so a new day opens the form again by itself.
 */
export default async function SessionCheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { locale, projectId } = await params;
  const { done } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh.checkin');

  if (!UUID.test(projectId)) {
    return (
      <div className="mx-auto max-w-md">
        <Alert tone="warn">{t('notFound')}</Alert>
      </div>
    );
  }

  const heading = (
    <div className="text-center">
      <p className="text-sm font-medium text-brand-600">{t('eyebrow')}</p>
      <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight text-ink">{t('title')}</h1>
    </div>
  );

  const account = await getGuestAccount();
  // A session of another project's account is nobody here.
  if (!account || account.project_id !== projectId) {
    return (
      <div className="mx-auto max-w-md space-y-5">
        {heading}
        <Card className="space-y-4">
          <div>
            <h2 className="font-semibold text-ink">{t('signIn.title')}</h2>
            <p className="mt-1 text-sm text-ink-muted">{t('signIn.body')}</p>
          </div>
          <SignInForm locale={locale} projectId={projectId} next={sessionCheckInPath(projectId)} />
        </Card>
        <p className="text-xs text-ink-muted">{t('signIn.howToGet')}</p>
      </div>
    );
  }

  const [today, points] = await Promise.all([getSessionToday(account.account_id), getSessionPoints(projectId)]);
  // Before 0009 is applied the database cannot answer.
  if (today === undefined || points === null) {
    return (
      <div className="mx-auto max-w-md space-y-5">
        {heading}
        <Alert tone="warn">{t('notReady')}</Alert>
      </div>
    );
  }

  const walletLink = (
    <Link href={accountHomePath(projectId)} className={LINK_BUTTON}>
      {t('toWallet')}
    </Link>
  );

  if (today) {
    return (
      <div className="mx-auto max-w-md space-y-5">
        {heading}
        {done ? (
          <section className="rounded-2xl bg-brand-950 p-6 text-center text-brand-50 shadow-sm" role="status">
            <p className="text-lg font-semibold">{t('done.title')}</p>
            {today.points > 0 ? (
              <>
                <p className="ltr-nums mt-3 text-5xl font-bold tracking-tight tabular-nums" dir="ltr">
                  +{formatQuroosh(today.points)}
                </p>
                <p className="mt-2 text-sm font-medium text-accent-2">
                  {t('done.added', { points: formatQuroosh(today.points) })}
                </p>
              </>
            ) : null}
          </section>
        ) : null}
        <Card className="space-y-4 text-center">
          <p className="text-sm text-ink-muted">{t('greeting', { name: account.name })}</p>
          <Alert tone="info">{t('already')}</Alert>
          <StarsShown rating={today.rating} label={t('yourRating', { rating: today.rating })} />
          <Button type="button" disabled className="min-h-12 w-full text-base">
            {t('submit')}
          </Button>
          <p className="text-xs text-ink-muted">{t('nextDay')}</p>
        </Card>
        {walletLink}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      {heading}
      <Card className="space-y-4">
        <p className="text-center text-sm text-ink-muted">{t('greeting', { name: account.name })}</p>
        <RatingForm
          locale={locale}
          projectId={projectId}
          labels={{
            question: t('question'),
            star: [t('stars.1'), t('stars.2'), t('stars.3'), t('stars.4'), t('stars.5')],
            pick: t('pick'),
            submit: t('submit'),
            sending: t('sending'),
          }}
        />
        {points > 0 ? (
          <p className="text-center text-xs text-ink-muted">{t('reward', { points: formatQuroosh(points) })}</p>
        ) : null}
      </Card>
      {walletLink}
    </div>
  );
}
