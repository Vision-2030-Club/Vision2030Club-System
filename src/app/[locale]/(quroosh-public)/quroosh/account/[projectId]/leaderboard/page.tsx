import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, cx } from '@/components/ui';
import { redirect } from '@/i18n/navigation';
import { accountHomePath, getGuestAccount } from '@/lib/quroosh/accounts';
import { formatQuroosh, getLeaderboard, getWalletOverview, shortName } from '@/lib/quroosh/wallet';
import { Medal, MEDALS } from '@/components/QurooshMedal';
import { GuestTabs } from '../../GuestTabs';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** How many places the page shows. */
const SHOWN = 20;

/**
 * The leaderboard (Quroosh 0007): the guests who collected the most quroosh,
 * for a signed-in guest of this project only.
 *
 * Other guests appear by first name and the first letter of their last, as
 * the Quroosh design shows them on the big screen; the reader sees their own
 * name whole, and their own place even when it is below the list.
 */
export default async function QurooshLeaderboardPage({
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

  const t = await getTranslations('quroosh.account');
  const [rows, mine] = await Promise.all([
    getLeaderboard(projectId, SHOWN),
    getWalletOverview(account.account_id),
  ]);
  const listed = (rows ?? []).some((row) => row.account_id === account.account_id);

  return (
    <div className="mx-auto max-w-md space-y-5">
      <GuestTabs projectId={projectId} current="leaderboard" />
      <div>
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink">{t('leaderboard.title')}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t('leaderboard.intro')}</p>
      </div>

      {rows === null ? (
        <Alert tone="warn">{t('leaderboard.notReady')}</Alert>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-muted">
          {t('leaderboard.empty')}
        </p>
      ) : (
        <ol className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
          {rows.map((row) => {
            const me = row.account_id === account.account_id;
            return (
              <li
                key={row.account_id}
                className={cx(
                  'flex items-center gap-3 p-4',
                  me && 'bg-surface-muted',
                  row.position <= 3 && cx('border-s-4', MEDALS[row.position - 1].strip),
                )}
              >
                {row.position <= 3 ? (
                  <Medal place={row.position} />
                ) : (
                  // The circle centres its number; `ltr-nums` sits on the number
                  // alone, since its inline-block would undo the circle's grid.
                  <span className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-ink-muted">
                    <span className="ltr-nums tabular-nums">{row.position}</span>
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {me ? t('leaderboard.you', { name: account.name }) : shortName(row.name)}
                </span>
                <span className="ltr-nums font-semibold tabular-nums text-ink" dir="ltr">
                  {formatQuroosh(row.earned)}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {mine && !listed && rows && rows.length > 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-muted p-4">
          <span className="ltr-nums shrink-0 text-sm font-bold tabular-nums text-ink-muted">
            {mine.earned > 0 ? mine.position : '–'}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-ink">
            {t('leaderboard.you', { name: account.name })}
          </span>
          <span className="ltr-nums font-semibold tabular-nums text-ink" dir="ltr">
            {formatQuroosh(mine.earned)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
