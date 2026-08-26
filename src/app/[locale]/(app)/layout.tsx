import { Suspense } from 'react';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { getMyMember, getMyPermissions } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { signAvatar } from '@/lib/avatars';
import { Avatar } from '@/components/Avatar';
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
/** Streams in after the shell; see the Suspense boundary below. */
async function HeaderAvatar({
  avatarPath,
  name,
}: {
  avatarPath: string | null;
  name: string;
}) {
  const photoUrl = await signAvatar(await createClient(), avatarPath);
  return <Avatar src={photoUrl} name={name} size={36} />;
}

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  /*
   * These two are independent, and this layout runs before EVERY page — so
   * awaiting them one after the other put two serial round trips in front of
   * every single navigation. `cache()` in lib/auth/session.ts still dedupes
   * them for the page itself.
   */
  const [member, permissions] = await Promise.all([getMyMember(), getMyPermissions()]);

  if (!member) {
    redirect({ href: '/login', locale });
  }

  const can = (key: string) => (permissions.get(key) ?? 'none') !== 'none';
  const t = await getTranslations('nav');
  const tApp = await getTranslations('app');

  /*
   * A Project Manager's projects are on their dashboard, so the club-wide
   * project list is not also in their menu — it would only ever be a second
   * route to the same handful of rows. This is the one place a role KEY
   * decides anything, and it decides a menu entry, not access: /projects still
   * answers for them, and their projects.view scope is untouched.
   */
  const isProjectManager = member!.role_key === 'project_manager';

  // `satisfies` (rather than a plain annotation) contextually types the
  // literal so each `icon` narrows to NavIconName instead of widening to
  // string — .filter() would otherwise strip that context away.
  const items: NavItem[] = (
    [
      { href: '/dashboard', label: t('dashboard'), icon: 'dashboard', show: true },
      {
        href: '/members',
        label: t('members'),
        icon: 'members',
        // The directory screen, not the right to read a member row. 0048
        // explains why those are two different permissions.
        show: can('members.directory'),
      },
      // Teams is where a team's posts live, so it follows the posts permission
      // rather than the directory one — a Guest holds neither.
      {
        href: '/teams',
        label: t('teams'),
        icon: 'teams',
        show: can('members.view') && can('team_posts.view'),
      },
      {
        href: '/projects',
        label: t('projects'),
        icon: 'projects',
        show: can('projects.view') && !isProjectManager,
      },
      { href: '/tasks', label: t('tasks'), icon: 'tasks', show: can('tasks.view') },
      {
        href: '/requests',
        label: t('requests'),
        icon: 'requests',
        show: can('requests.submit') || can('requests.view'),
      },
      { href: '/calendar', label: t('calendar'), icon: 'calendar', show: true },
      { href: '/assets', label: t('assets'), icon: 'assets', show: can('assets.view') },
      {
        href: '/attendance',
        label: t('attendance'),
        icon: 'attendance',
        show: can('attendance.view'),
      },
      // §4/§6: the room schedule and the act of booking share one population.
      // A plain Member holds no rooms.book scope and sees neither.
      { href: '/rooms', label: t('rooms'), icon: 'rooms', show: can('rooms.book') },
      // §8: View KPI is its own permission — nothing else unlocks this page.
      { href: '/kpi', label: t('kpi'), icon: 'kpi', show: can('kpi.view') },
      {
        href: '/admin',
        label: t('admin'),
        icon: 'admin',
        show:
          can('roles.configure') || can('request_types.configure') || can('import.run'),
      },
    ] satisfies NavItem[]
  ).filter((item) => item.show);

  const isArabic = locale === 'ar';
  const displayName = isArabic ? member!.name_ar : member!.name_en;
  const roleName = isArabic ? member!.role_name_ar : member!.role_name_en;
  const teamName = isArabic ? member!.team_name_ar : member!.team_name_en;

  return (
    <div className="min-h-dvh">
      {/*
        Every page here puts a logo, a profile link, a language switch and a
        dozen nav links before the content. Without this a keyboard user tabs
        through all of it on every single page. Hidden until focused.
      */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        {t('skipToContent')}
      </a>

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
            {/* The photo and the name are the way to your own profile — the
                only page in here that is about you rather than about work. */}
            <Link
              href={`/members/${member!.id}`}
              className="flex items-center gap-3 rounded-lg px-1 py-0.5 hover:bg-surface-muted"
            >
              {/*
                Signing a photo URL is a Storage round trip, and it used to
                block the whole shell on every page load to mint a URL that is
                never reused. Behind Suspense the initials paint immediately
                and the photo swaps in when it arrives.
              */}
              <Suspense fallback={<Avatar name={displayName} size={36} />}>
                <HeaderAvatar avatarPath={member!.avatar_path} name={displayName} />
              </Suspense>
              <span className="text-end">
                <span className="block text-sm font-medium text-ink">{displayName}</span>
                <span className="block text-xs text-ink-muted">
                  {/* "Team Director" is one role; the UI composes the label. */}
                  {member!.role_key === 'team_director'
                    ? isArabic
                      ? `${roleName} — ${teamName}`
                      : `Director of ${teamName}`
                    : `${roleName} · ${teamName}`}
                </span>
              </span>
            </Link>
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
      </header>

      {/*
        The sidebar is the FIRST child of this row, so `dir` on <html> decides
        which edge it hugs: left for English, right for Arabic. `min-w-0` on
        <main> keeps wide tables scrolling inside themselves instead of
        stretching the row.
      */}
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row">
        <aside className="lg:w-60 lg:shrink-0">
          <div className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
            <NavLinks items={items} menuLabel={t('menu')} />
          </div>
        </aside>

        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
