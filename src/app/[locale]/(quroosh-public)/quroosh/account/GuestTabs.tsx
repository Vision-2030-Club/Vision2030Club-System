import { getTranslations } from 'next-intl/server';
import { cx } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { accountHomePath } from '@/lib/quroosh/accounts';
import { getFinalStatus } from '@/lib/quroosh/final';

type GuestTab = 'wallet' | 'challenges' | 'leaderboard' | 'final';

/**
 * The guest's way around the Quroosh market (Quroosh 0007): the wallet, the
 * booths' challenges (0008), the leaderboard, and the Final Wave (0014) once
 * the managers show it. While giving is open its tab carries a small mint
 * dot, so guests notice it.
 */
export async function GuestTabs({ projectId, current }: { projectId: string; current: GuestTab }) {
  const t = await getTranslations('quroosh.account.tabs');
  const home = accountHomePath(projectId);
  // Null before 0014 is applied: the tab is simply not there.
  const final = await getFinalStatus(projectId);
  const tabs: { key: GuestTab; href: string; live?: boolean }[] = [
    { key: 'wallet', href: home },
    { key: 'challenges', href: `${home}/challenges` },
    { key: 'leaderboard', href: `${home}/leaderboard` },
  ];
  if (final === 'open' || final === 'closed' || current === 'final') {
    tabs.push({ key: 'final', href: `${home}/final`, live: final === 'open' });
  }

  return (
    <nav aria-label={t('label')} className="flex gap-1 rounded-full border border-line bg-surface p-1 shadow-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? 'page' : undefined}
          className={cx(
            'relative flex-1 whitespace-nowrap rounded-full py-2.5 text-center font-semibold',
            tabs.length > 3 ? 'px-1 text-[13px] sm:text-sm' : 'px-2 text-sm',
            tab.key === current ? 'bg-brand-950 text-accent-2' : 'text-ink-muted hover:bg-surface-muted',
          )}
        >
          {t(tab.key)}
          {tab.live && tab.key !== current ? (
            <span aria-hidden="true" className="absolute top-1.5 end-2 flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-3 opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-accent-3" />
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
