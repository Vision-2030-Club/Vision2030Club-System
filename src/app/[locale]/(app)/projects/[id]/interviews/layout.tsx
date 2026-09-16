import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Badge, PageHeader } from '@/components/ui';
import { localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { SubNav, type SubNavItem } from './SubNav';

/**
 * The frame around every Mock Interviews page of one project.
 *
 * Access is resolved once here — the club database says whether this person
 * may enter and as what — and every page underneath asks the same cached
 * question for its own checks. Somebody with no access gets a 404, not a
 * page of refusals.
 */
export default async function InterviewsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access) notFound();

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');

  const title = localized(access.project, 'name', locale);
  const base = `/projects/${id}/interviews`;
  const { role } = access;

  const back = can.manage(role)
    ? { href: `/projects/${id}`, label: tCommon('back') }
    : { href: '/dashboard', label: tCommon('back') };

  if (!access.configured || !access.edition) {
    return (
      <>
        <PageHeader back={back} title={title} description={t('subtitle')} />
        <Alert tone="warn">{access.configured ? t('noEdition') : t('notConfigured')}</Alert>
      </>
    );
  }

  const tabs: (SubNavItem & { show: boolean })[] = [
    { href: base, label: t('tabs.overview'), exact: true, show: true },
    { href: `${base}/applicants`, label: t('tabs.applicants'), show: can.decide(role) },
    { href: `${base}/companies`, label: t('tabs.companies'), show: role !== 'organizer' },
    { href: `${base}/schedule`, label: t('tabs.schedule'), show: true },
    { href: `${base}/floor`, label: t('tabs.floor'), show: true },
    { href: `${base}/bookings`, label: t('tabs.bookings'), show: can.manage(role) },
    { href: `${base}/people`, label: t('tabs.people'), show: can.roster(role) },
    { href: `${base}/settings`, label: t('tabs.settings'), show: can.manage(role) },
    { href: `${base}/log`, label: t('tabs.log'), show: can.manage(role) },
    { href: `${base}/messages`, label: t('tabs.messages'), show: can.manage(role) },
  ];

  const status = access.edition.status;

  return (
    <>
      <PageHeader
        back={back}
        title={title}
        description={t('subtitle')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status === 'active' ? 'ok' : status === 'archived' ? 'neutral' : 'warn'}>
              {t(`status.${status}`)}
            </Badge>
            <Badge tone="brand">{t(`role.${role}`)}</Badge>
          </div>
        }
      />
      <SubNav items={tabs.filter((tab) => tab.show)} />
      {children}
    </>
  );
}
