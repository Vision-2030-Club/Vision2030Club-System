import { Suspense } from 'react';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { getMyMember, getMyPermissions } from '@/lib/auth/session';
import { can, componentHref, getMyComponentAccess } from '@/lib/interviews/access';
import { createClient } from '@/lib/supabase/server';
import { signAvatar } from '@/lib/avatars';
import { AppShell, type ComponentShell } from '@/components/AppShell';
import { Avatar } from '@/components/Avatar';
import { InterviewsLogo } from '@/components/InterviewsLogo';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { type NavItem } from '@/components/NavLinks';
import { ProfileMenu } from '@/components/ProfileMenu';
import { RegisterServiceWorker } from '@/components/RegisterServiceWorker';
import { signOutAction } from '../login/actions';

/**
 * Shell for every signed-in page.
 *
 * The navigation is filtered by the permission map, so people only see
 * sections they can actually use. That is a convenience, not a security
 * measure — the pages themselves and the database enforce access again.
 *
 * The shell itself (header, sidebar, the crossing into a project component's
 * own pages and colours) is `AppShell`; this file decides what goes in it.
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
   * These three are independent, and this layout runs before EVERY page — so
   * awaiting them one after the other would put serial round trips in front
   * of every single navigation. `cache()` in lib/auth/session.ts still dedupes
   * them for the page itself.
   */
  const [member, permissions, components] = await Promise.all([
    getMyMember(),
    getMyPermissions(),
    // Which project components (Mock Interviews) this person may open.
    getMyComponentAccess(),
  ]);

  if (!member) {
    redirect({ href: '/login', locale });
  }

  const canDo = (key: string) => (permissions.get(key) ?? 'none') !== 'none';
  const t = await getTranslations('nav');
  const tApp = await getTranslations('app');
  const tMembers = await getTranslations('members');
  const tInterviews = await getTranslations('interviews');

  /*
   * A Project Manager's projects are on their dashboard, so the club-wide
   * project list is not also in their menu — it would only ever be a second
   * route to the same handful of rows. This is the one place a role KEY
   * decides anything, and it decides a menu entry, not access: /projects still
   * answers for them, and their projects.view scope is untouched.
   */
  const isProjectManager = member!.role_key === 'project_manager';

  /*
   * A project that carries a component gets its own button, named after the
   * project, for exactly the people the club database says may enter it
   * (0062: its managers, its organizers, HR). Inside, the sidebar becomes
   * that component's pages — filtered by the role the club gave this person.
   */
  // A project carrying both components gets two buttons, so the outreach one
  // says which it is; on its own it would just repeat the project's name.
  const tOutreach = await getTranslations('outreach');
  const componentItems: NavItem[] = components.map((component) => {
    const name = locale === 'ar' ? component.name_ar : component.name_en;
    return {
      href: componentHref(component.project_id, component.component_key),
      label: component.component_key === 'outreach' ? `${name} · ${tOutreach('title')}` : name,
      icon: component.component_key === 'outreach' ? 'company' : 'interviews',
      show: true,
    };
  });

  // Only Mock Interviews is a world of its own (own pages, own brand).
  // Outreach is one page inside the club shell.
  const componentShells: ComponentShell[] = components
    .filter((component) => component.component_key === 'mock_interviews')
    .map((component) => {
    const base = `/projects/${component.project_id}/interviews`;
    const role = component.role;
    const label = locale === 'ar' ? component.name_ar : component.name_en;
    const items: NavItem[] = (
      [
        { href: base, label: tInterviews('tabs.overview'), icon: 'dashboard', show: true },
        { href: `${base}/applicants`, label: tInterviews('tabs.applicants'), icon: 'members', show: can.decide(role) },
        { href: `${base}/companies`, label: tInterviews('tabs.companies'), icon: 'company', show: role !== 'organizer' },
        { href: `${base}/schedule`, label: tInterviews('tabs.schedule'), icon: 'calendar', show: true },
        { href: `${base}/floor`, label: tInterviews('tabs.floor'), icon: 'stage', show: true },
        { href: `${base}/bookings`, label: tInterviews('tabs.bookings'), icon: 'tasks', show: can.manage(role) },
        { href: `${base}/people`, label: tInterviews('tabs.people'), icon: 'teams', show: can.roster(role) },
        { href: `${base}/settings`, label: tInterviews('tabs.settings'), icon: 'admin', show: can.manage(role) },
        { href: `${base}/log`, label: tInterviews('tabs.log'), icon: 'requests', show: can.manage(role) },
        { href: `${base}/messages`, label: tInterviews('tabs.messages'), icon: 'mail', show: can.manage(role) },
      ] satisfies NavItem[]
    ).filter((item) => item.show);

    return {
      projectId: component.project_id,
      label,
      items,
      backHref: can.manage(role) ? `/projects/${component.project_id}` : '/dashboard',
      logo: <InterviewsLogo name={label} />,
    };
  });

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
        show: canDo('members.directory'),
      },
      // Teams is where a team's posts live, so it follows the posts permission
      // rather than the directory one — a Guest holds neither.
      {
        href: '/teams',
        label: t('teams'),
        icon: 'teams',
        show: canDo('members.view') && canDo('team_posts.view'),
      },
      {
        href: '/projects',
        label: t('projects'),
        icon: 'projects',
        show: canDo('projects.view') && !isProjectManager,
      },
      { href: '/tasks', label: t('tasks'), icon: 'tasks', show: canDo('tasks.view') },
      {
        href: '/requests',
        label: t('requests'),
        icon: 'requests',
        show: canDo('requests.submit') || canDo('requests.view'),
      },
      { href: '/calendar', label: t('calendar'), icon: 'calendar', show: true },
      { href: '/assets', label: t('assets'), icon: 'assets', show: canDo('assets.view') },
      {
        href: '/attendance',
        label: t('attendance'),
        icon: 'attendance',
        show: canDo('attendance.view'),
      },
      // §4/§6: the room schedule and the act of booking share one population.
      // A plain Member holds no rooms.book scope and sees neither.
      { href: '/rooms', label: t('rooms'), icon: 'rooms', show: canDo('rooms.book') },
      // §8: View KPI is its own permission — nothing else unlocks this page.
      { href: '/kpi', label: t('kpi'), icon: 'kpi', show: canDo('kpi.view') },
      ...componentItems,
      {
        href: '/admin',
        label: t('admin'),
        icon: 'admin',
        show:
          canDo('roles.configure') || canDo('request_types.configure') || canDo('import.run'),
      },
    ] satisfies NavItem[]
  ).filter((item) => item.show);

  const isArabic = locale === 'ar';
  const displayName = isArabic ? member!.name_ar : member!.name_en;
  const roleName = isArabic ? member!.role_name_ar : member!.role_name_en;
  const teamName = isArabic ? member!.team_name_ar : member!.team_name_en;

  return (
    <>
      <RegisterServiceWorker />
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

      <AppShell
        clubItems={items}
        components={componentShells}
        menuLabel={t('menu')}
        backLabel={t('backToClub')}
        clubLogo={
          <Image
            src="/brand/logo-horizontal.png"
            alt={tApp('name')}
            width={200}
            height={48}
            priority
            className="h-8 w-auto"
          />
        }
        headerEnd={
          /* The photo and the name open a short menu: your profile — the
             only page in here that is about you rather than about work —
             the language, and sign out. */
          <ProfileMenu
            label={t('menu')}
            trigger={
              <>
                {/*
                  Signing a photo URL is a Storage round trip, and it used to
                  block the whole shell on every page load to mint a URL that
                  is never reused. Behind Suspense the initials paint
                  immediately and the photo swaps in when it arrives.
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
              </>
            }
          >
            <Link
              href={`/members/${member!.id}`}
              role="menuitem"
              className="block rounded px-3 py-2 text-sm text-ink hover:bg-surface-muted"
            >
              {tMembers('profile')}
            </Link>
            <LocaleSwitch className="block w-full rounded px-3 py-2 text-start text-sm text-ink hover:bg-surface-muted" />
            <form action={signOutAction}>
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                role="menuitem"
                className="block w-full rounded px-3 py-2 text-start text-sm text-ink hover:bg-surface-muted"
              >
                {t('signOut')}
              </button>
            </form>
          </ProfileMenu>
        }
      >
        {children}
      </AppShell>
    </>
  );
}
