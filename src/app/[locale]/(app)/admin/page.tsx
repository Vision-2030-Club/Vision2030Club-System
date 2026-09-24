import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { hasPermission, scopeFor } from '@/lib/auth/session';
import { Card, PageHeader } from '@/components/ui';

export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('admin');

  const sections = [
    {
      href: '/admin/permissions',
      title: t('permissions'),
      hint: t('permissionsHint'),
      show: await hasPermission('roles.configure'),
    },
    {
      href: '/admin/request-types',
      title: t('requestTypes'),
      hint: t('requestTypesHint'),
      show: await hasPermission('request_types.configure'),
    },
    {
      href: '/admin/import',
      title: t('import'),
      hint: t('importHint'),
      show: await hasPermission('import.run'),
    },
    {
      href: '/admin/rooms',
      title: t('rooms'),
      hint: t('roomsHint'),
      show: await hasPermission('rooms.manage'),
    },
    {
      href: '/admin/semester',
      title: t('semester'),
      hint: t('semesterHint'),
      // Club scope on the calendar is what makes club dates yours to set; a
      // Director holds the same permission for their own team only.
      show: (await scopeFor('calendar.manage')) === 'all',
    },
    {
      href: '/admin/google',
      title: t('google'),
      hint: t('googleHint'),
      show: await hasPermission('integrations.configure'),
    },
  ].filter((section) => section.show);

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Link key={section.href} href={section.href} className="block">
            <Card className="h-full transition hover:border-brand-300 hover:shadow">
              <h2 className="font-semibold text-brand-700">{section.title}</h2>
              <p className="mt-2 text-sm text-ink-muted">{section.hint}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
