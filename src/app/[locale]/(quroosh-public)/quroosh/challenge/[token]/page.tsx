import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Alert, Card } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { accountHomePath, getGuestAccount } from '@/lib/quroosh/accounts';
import { formatSeconds, getChallengeByToken, getChallengeState } from '@/lib/quroosh/challenges';
import { formatQuroosh, formatSigned } from '@/lib/quroosh/wallet';
import { startChallengeAction } from '../actions';
import { QuestionForm } from './QuestionForm';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const LINK_BUTTON =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-muted';

/**
 * A booth's challenge: /quroosh/challenge/<the code in the booth's QR>
 * (Quroosh 0008). One page, four faces:
 *
 *   nobody signed in   a word on signing in first
 *   not started        what the challenge is, and Start
 *   in the middle      the question the guest is on, with its countdown
 *   finished           what they got
 *
 * Which face is decided by the database each time the page is read, so
 * leaving and coming back lands on the same question with its clock still
 * running.
 */
export default async function QurooshChallengePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh.challenge');

  const challenge = await getChallengeByToken(token);
  if (!challenge) {
    return (
      <div className="mx-auto max-w-md">
        <Alert tone="warn">{t('notFound')}</Alert>
      </div>
    );
  }

  const home = accountHomePath(challenge.project_id);
  const heading = (
    <div>
      <p className="text-sm text-ink-muted">{t('booth', { booth: challenge.booth })}</p>
      {challenge.topic ? <p className="mt-1 text-sm font-medium text-ink">{challenge.topic}</p> : null}
    </div>
  );

  const account = await getGuestAccount();
  if (!account || account.project_id !== challenge.project_id) {
    return (
      <div className="mx-auto max-w-md space-y-5">
        {heading}
        <Card className="space-y-3">
          <h1 className="text-xl font-semibold text-ink">{t('signInTitle')}</h1>
          <p className="text-sm text-ink-muted">{t('signInBody')}</p>
          <Link href={home} className={LINK_BUTTON}>
            {t('signIn')}
          </Link>
        </Card>
      </div>
    );
  }

  const state = await getChallengeState(account.account_id, challenge.id);
  if (!state) {
    return (
      <div className="mx-auto max-w-md">
        <Alert tone="warn">{t('notFound')}</Alert>
      </div>
    );
  }

  if (state.status === 'open') {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-between gap-3">
          {heading}
          <span className="shrink-0 text-sm font-semibold text-ink-muted">
            {t('progress', { number: state.number, total: state.total })}
          </span>
        </div>
        <QuestionForm
          key={state.question.id}
          locale={locale}
          token={token}
          questionId={state.question.id}
          prompt={state.question.prompt}
          options={state.question.options}
          remainingMs={state.remaining_ms}
          seconds={state.seconds}
          labels={{
            next: state.number === state.total ? t('finish') : t('next'),
            timeLeft: t('timeLeft'),
            timeUp: t('timeUp'),
            letters: [t('letters.a'), t('letters.b'), t('letters.c'), t('letters.d')],
          }}
        />
      </div>
    );
  }

  if (state.status === 'done') {
    return (
      <div className="mx-auto max-w-md space-y-5">
        {heading}
        <section className="rounded-2xl bg-brand-950 p-6 text-center text-brand-50 shadow-sm">
          <p className="ltr-nums text-5xl font-bold tracking-tight tabular-nums" dir="ltr">
            {state.points > 0 ? formatSigned(state.points) : '0'}
          </p>
          <p className="mt-2 text-sm font-medium text-accent-2">
            {state.points > 0 ? t('result.added') : t('result.nothing')}
          </p>
        </section>
        <dl className="grid grid-cols-3 gap-3 text-center">
          {[
            { label: t('result.correct'), value: `${state.correct}/${state.total}` },
            { label: t('result.time'), value: t('result.seconds', { seconds: formatSeconds(state.ms) }) },
            { label: t('result.place'), value: `#${state.place}` },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-line bg-surface p-3 shadow-sm">
              <dd className="ltr-nums text-lg font-semibold tabular-nums text-ink">{item.value}</dd>
              <dt className="mt-1 text-xs text-ink-muted">{item.label}</dt>
            </div>
          ))}
        </dl>
        <p className="text-sm text-ink-muted">{t('result.once')}</p>
        <Link href={home} className={LINK_BUTTON}>
          {t('result.back')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      {heading}
      <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink">{t('intro.title')}</h1>
      {challenge.playable && challenge.questions > 0 ? (
        <>
          <Card>
            <ul className="list-disc space-y-2 ps-5 text-sm text-ink">
              <li>{t('intro.questions', { count: challenge.questions })}</li>
              <li>{t('intro.seconds', { seconds: challenge.seconds_per_question })}</li>
              <li>{t('intro.points', { points: formatQuroosh(challenge.max_points) })}</li>
              <li>{t('intro.once')}</li>
            </ul>
          </Card>
          <ActionForm action={startChallengeAction} submitLabel={t('intro.start')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <p className="text-xs text-ink-muted">{t('intro.clock')}</p>
          </ActionForm>
        </>
      ) : (
        <Alert tone="warn">{t('closed')}</Alert>
      )}
      <Link href={home} className={LINK_BUTTON}>
        {t('result.back')}
      </Link>
    </div>
  );
}
