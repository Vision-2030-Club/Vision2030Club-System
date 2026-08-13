import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getMyMember, getMyPermissions } from '@/lib/auth/session';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { NavLinks, type NavItem } from '@/components/NavLinks';
import { signOutAction } from '../login/actions';

/**
 * Shell for every signed-in page.
 *
 * The navigation is filtered by the permission map, so people only see
 * sections they can actually use. That is a convenience, not a security
 * measure — the pages themselves and the database enforce access again.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const member = await getMyMember();
  if (!member) {
    redirect({ href: '/login', locale });
  }

  const permissions = await getMyPermissions();
  const can = (key: string) => (permissions.get(key) ?? 'none') !== 'none';
  const t = await getTranslations('nav');
  const tApp = await getTranslations('app');

  const items: NavItem[] = [
    { href: '/dashboard', label: t('dashboard'), show: true },
    { href: '/members', label: t('members'), show: can('members.view') },
    { href: '/teams', label: t('teams'), show: can('members.view') },
    { href: '/projects', label: t('projects'), show: can('projects.view') },
    { href: '/tasks', label: t('tasks'), show: can('tasks.view') },
    {
      href: '/requests',
      label: t('requests'),
      show: can('requests.submit') || can('requests.view'),
    },
    { href: '/calendar', label: t('calendar'), show: true },
    { href: '/assets', label: t('assets'), show: can('assets.view') },
    { href: '/attendance', label: t('attendance'), show: can('attendance.view') },
    {
      href: '/admin',
      label: t('admin'),
      show:
        can('roles.configure') || can('request_types.configure') || can('import.run'),
    },
  ].filter((item) => item.show);

  const isArabic = locale === 'ar';
  const displayName = isArabic ? member!.name_ar : member!.name_en;
  const roleName = isArabic ? member!.role_name_ar : member!.role_name_en;
  const teamName = isArabic ? member!.team_name_ar : member!.team_name_en;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <Image
            src="/brand/logo-horizontal.png"
            alt={tApp('name')}
            width={200}
            height={48}
            priority
            className="h-8 w-auto"
          />

          <div className="ms-auto flex items-center gap-3">
            <div className="text-end">
              <div className="text-sm font-medium text-ink">{displayName}</div>
              <div className="text-xs text-ink-muted">
                {/* "Team Director" is one role; the UI composes the label. */}
                {member!.role_key === 'team_director'
                  ? isArabic
                    ? `${roleName} — ${teamName}`
                    : `Director of ${teamName}`
                  : `${roleName} · ${teamName}`}
              </div>
            </div>
            <LocaleSwitch />
            <form action={signOutAction}>
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-muted"
              >
                {t('signOut')}
              </button>
            </form>
          </div>
        </div>

        <NavLinks items={items} />
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
