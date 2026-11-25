import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { accountHomePath, getGuestAccount } from '@/lib/quroosh/accounts';
import { getFinalBoard, getFinalProjectsFor, getFinalStatus } from '@/lib/quroosh/final';
import { getWalletOverview } from '@/lib/quroosh/wallet';
import { FinalView } from './FinalView';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** How many projects the ceremony's leaderboard shows. */
const TOP = 10;

/**
 * The Final Wave (الحفل الختامي, Quroosh 0014), for a signed-in guest of this
 * project: the projects pitching at the closing ceremony, each with its
 * brief, and giving them quroosh from the wallet in steps of 250; above them,
 * the ten projects that collected the most.
 *
 * Giving lowers the guest's balance, never their own place on the guests'
 * leaderboard (that counts what they earned). Hidden by the managers, the
 * page sends the guest to their wallet; closed, it shows the results and no
 * giving.
 */
export default async function QurooshFinalPage({
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

  const status = await getFinalStatus(projectId);
  if (status === 'hidden') {
    redirect({ href: accountHomePath(projectId), locale });
    return null;
  }

  const [projects, board, wallet] = await Promise.all([
    status ? getFinalProjectsFor(account.account_id) : null,
    status ? getFinalBoard(projectId, TOP) : null,
    getWalletOverview(account.account_id),
  ]);

  return (
    <FinalView
      locale={locale}
      projectId={projectId}
      status={status}
      projects={projects}
      board={board}
      balance={wallet?.balance ?? 0}
    />
  );
}
