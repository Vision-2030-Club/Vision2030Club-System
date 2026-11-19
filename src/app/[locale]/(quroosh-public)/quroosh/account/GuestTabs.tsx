import { getTranslations } from 'next-intl/server';
import { cx } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { accountHomePath } from '@/lib/quroosh/accounts';

/**
 * The guest's way around the Quroosh market (Quroosh 0007): the wallet, the
 * booths' challenges (0008) and the leaderboard. The projects join this row
 * when they are built.
 */
export async function GuestTabs({ projectId, current }: { projectId: string; current: 'wallet' | 'challenges' | 'leaderboard' }) {
  const t = await getTranslations('quroosh.account.tabs');
  const home = accountHomePath(projectId);
  const tabs = [
    { key: 'wallet', href: home },
    { key: 'challenges', href: `${home}/challenges` },
    { key: 'leaderboard', href: `${home}/leaderboard` },
  ] as const;

  return (
    <nav aria-label={t('label')} className="flex gap-1 rounded-xl border border-line bg-surface p-1 shadow-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? 'page' : undefined}
          className={cx(
            'flex-1 rounded-lg px-2 py-2 text-center text-sm font-semibold',
            tab.key === current ? 'bg-brand-950 text-accent-2' : 'text-ink-muted hover:bg-surface-muted',
          )}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
