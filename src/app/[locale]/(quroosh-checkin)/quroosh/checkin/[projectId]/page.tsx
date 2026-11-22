import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Button, Card } from '@/components/ui';
import { QurooshCard, QurooshNote, QurooshPage } from '@/components/QurooshHero';
import { Link } from '@/i18n/navigation';
import { accountHomePath } from '@/lib/quroosh/accounts';
import {
  canCheckInByEmail,
  getCheckInGuest,
  getSessionPoints,
  getSessionToday,
  sessionCheckInPath,
} from '@/lib/quroosh/sessions';
import { formatQuroosh } from '@/lib/quroosh/wallet';
import { MailIcon, SignInForm } from '@/app/[locale]/(quroosh-public)/quroosh/account/SignInForm';
import { changeEmailAction, enterEmailAction } from '../actions';
import { RatingForm, StarsShown } from './RatingForm';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LINK_BUTTON =
  'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-muted';

/**
 * The dialogue session's check-in: /quroosh/checkin/<club project id>
 * (Quroosh 0009). What the organizers' QR code opens. One page, three faces:
 *
 *   nobody known            type the email on the pass, nothing is sent (0011);
 *                           before 0011 is applied, the emailed sign-in link
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
  const tq = await getTranslations('quroosh');

  const frame = (body: React.ReactNode) => (
    <QurooshPage name={tq('name')} title={t('title')} subtitle={t('subtitle')}>
      {body}
    </QurooshPage>
  );

  if (!UUID.test(projectId)) {
    return frame(<Alert tone="warn">{t('notFound')}</Alert>);
  }

  // The signed-in guest, or the account of the email typed on this device.
  const account = await getCheckInGuest(projectId);
  if (!account) {
    const byEmail = await canCheckInByEmail(projectId);
    return frame(
      <>
        <QurooshCard icon={<MailIcon className="size-5" />} title={t(byEmail ? 'byEmail.title' : 'signIn.title')}>
          {byEmail ? (
            <SignInForm
              locale={locale}
              projectId={projectId}
              action={enterEmailAction}
              look={{ label: t('signIn.email'), hint: t('byEmail.hint'), submit: t('byEmail.submit') }}
            />
          ) : (
            <SignInForm
              locale={locale}
              projectId={projectId}
              next={sessionCheckInPath(projectId)}
              look={{ label: t('signIn.email'), hint: t('signIn.hint'), submit: t('signIn.submit') }}
            />
          )}
        </QurooshCard>
        <QurooshNote>
          {t('signIn.noAccount')} {t('signIn.howToGet')}
        </QurooshNote>
      </>,
    );
  }

  const [today, points] = await Promise.all([getSessionToday(account.account_id), getSessionPoints(projectId)]);
  // Before 0009 is applied the database cannot answer.
  if (today === undefined || points === null) {
    return frame(<Alert tone="warn">{t('notReady')}</Alert>);
  }

  // Someone who only typed an email is greeted by first name: the full name
  // on the account is not shown to whoever knows the address.
  const name = account.byEmail ? (account.name.trim().split(/\s+/)[0] ?? '') : account.name;
  const walletLink = (
    <>
      <Link href={accountHomePath(projectId)} className={LINK_BUTTON}>
        {t('toWallet')}
      </Link>
      {account.byEmail ? (
        <form action={changeEmailAction} className="text-center">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="project_id" value={projectId} />
          <button type="submit" className="text-sm font-medium text-brand-600 hover:underline">
            {t('byEmail.change')}
          </button>
        </form>
      ) : null}
    </>
  );

  if (today) {
    return frame(
      <>
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
          <p className="text-sm text-ink-muted">{t('greeting', { name })}</p>
          <Alert tone="info">{t('already')}</Alert>
          <StarsShown rating={today.rating} label={t('yourRating', { rating: today.rating })} />
          <Button type="button" disabled className="min-h-12 w-full text-base">
            {t('submit')}
          </Button>
          <p className="text-xs text-ink-muted">{t('nextDay')}</p>
        </Card>
        {walletLink}
      </>,
    );
  }

  return frame(
    <>
      <Card className="space-y-4">
        <p className="text-center text-sm text-ink-muted">{t('greeting', { name })}</p>
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
    </>,
  );
}
