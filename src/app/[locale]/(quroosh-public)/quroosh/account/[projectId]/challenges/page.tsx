import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Badge, Card } from '@/components/ui';
import { redirect } from '@/i18n/navigation';
import { accountHomePath, getGuestAccount } from '@/lib/quroosh/accounts';
import { getGuestChallenges } from '@/lib/quroosh/challenges';
import { formatQuroosh, formatSigned } from '@/lib/quroosh/wallet';
import { GuestTabs } from '../../GuestTabs';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Today's challenges (Quroosh 0008), for a signed-in guest of this project:
 * which booths have one, and what the guest got in those they played.
 *
 * There is no way to start one from here, on purpose: a challenge begins by
 * scanning the QR code at its booth, so that the guest is standing there.
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
  const challenges = await getGuestChallenges(account.account_id);

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
        <ul className="space-y-3">
          {challenges.map((challenge) => (
            <li key={challenge.id} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{challenge.booth}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {[t('questions', { count: challenge.questions }), challenge.topic].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {challenge.status === 'done' ? (
                  <span className="ltr-nums shrink-0 font-semibold tabular-nums text-ok" dir="ltr">
                    {challenge.points ? formatSigned(challenge.points) : '0'}
                  </span>
                ) : (
                  <span className="ltr-nums shrink-0 text-sm font-medium text-ink-muted" dir="ltr">
                    {t('upTo', { points: formatQuroosh(challenge.max_points) })}
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={challenge.status === 'done' ? 'ok' : challenge.status === 'open' ? 'warn' : 'brand'}>
                  {t(`status.${challenge.status}`)}
                </Badge>
                {challenge.status === 'done' ? null : (
                  <span className="text-xs text-ink-muted">{t('scanToStart')}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
