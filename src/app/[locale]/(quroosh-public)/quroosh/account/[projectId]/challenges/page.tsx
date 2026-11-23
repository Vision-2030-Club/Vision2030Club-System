import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Card } from '@/components/ui';
import { Link, redirect } from '@/i18n/navigation';
import { accountHomePath, getGuestAccount } from '@/lib/quroosh/accounts';
import { getGuestChallenges, type GuestChallenge } from '@/lib/quroosh/challenges';
import { formatQuroosh, formatSigned } from '@/lib/quroosh/wallet';
import { GuestTabs } from '../../GuestTabs';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Each card is framed in its status's colour, with a thicker strip on the
 * reading side: new in lavender, started but not finished in the coins'
 * purple, finished in mint.
 */
const STATUS_LOOK: Record<GuestChallenge['status'], { frame: string; badge: string }> = {
  new: { frame: 'border-brand-200 border-s-brand-300', badge: 'bg-brand-200 text-brand-950' },
  open: { frame: 'border-coin/50 border-s-coin', badge: 'bg-coin text-brand-50' },
  done: { frame: 'border-accent border-s-accent-3', badge: 'bg-accent text-brand-950' },
};

/**
 * Today's challenges (Quroosh 0008), for a signed-in guest of this project:
 * which booths have one, and what the guest got in those they played.
 *
 * Each card opens its challenge, the same page the booth's QR code opens, so
 * a guest can play from here without scanning. A finished one shows the
 * result.
 */
export default async function QurooshChallengesPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);

  const account = await getGuestAccount();
  if (!account || account.project_id !== projectId) {
    redirect({ href: accountHomePath(projectId), locale });
    return null;
  }

  const t = await getTranslations('quroosh.account.challenges');
  const challenges = await getGuestChallenges(account.account_id, projectId);

  return (
    <div className="mx-auto max-w-md space-y-5">
      <GuestTabs projectId={projectId} current="challenges" />
      <div>
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink">{t('title')}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t('intro')}</p>
      </div>

      <Card>
        <ul className="list-disc space-y-1 ps-5 text-sm text-ink-muted">
          <li>{t('rules.scan')}</li>
          <li>{t('rules.speed')}</li>
          <li>{t('rules.once')}</li>
        </ul>
      </Card>

      {challenges === null ? (
        <Alert tone="warn">{t('notReady')}</Alert>
      ) : challenges.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-muted">{t('empty')}</p>
      ) : (
        <ul className="space-y-4">
          {challenges.map((challenge) => {
            const look = STATUS_LOOK[challenge.status];
            const body = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-ink">{challenge.booth}</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {[t('questions', { count: challenge.questions }), challenge.topic].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {challenge.status === 'done' ? (
                    <span className="ltr-nums shrink-0 text-xl font-bold tabular-nums text-accent-3" dir="ltr">
                      {challenge.points ? formatSigned(challenge.points) : '0'}
                    </span>
                  ) : (
                    <span className="ltr-nums shrink-0 text-sm font-medium text-ink-muted" dir="ltr">
                      {t('upTo', { points: formatQuroosh(challenge.max_points) })}
                    </span>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${look.badge}`}>
                    {t(`status.${challenge.status}`)}
                  </span>
                  {challenge.token ? (
                    <span className="text-xs font-medium text-ink-muted">{t(`tap.${challenge.status}`)}</span>
                  ) : null}
                </div>
              </>
            );
            const frame = `block rounded-2xl border-2 border-s-[6px] bg-surface p-5 ${look.frame}`;
            return (
              <li key={challenge.id}>
                {challenge.token ? (
                  <Link
                    href={`/quroosh/challenge/${challenge.token}`}
                    className={`${frame} transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.99]`}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className={frame}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
