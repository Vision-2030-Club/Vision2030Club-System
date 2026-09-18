import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Badge, PageHeader } from '@/components/ui';
import { localized } from '@/lib/format';
import { getInterviewAccess } from '@/lib/interviews/access';

/**
 * The frame around every Mock Interviews page of one project.
 *
 * Access is resolved once here — the club database says whether this person
 * may enter and as what — and every page underneath asks the same cached
 * question for its own checks. Somebody with no access gets a 404, not a
 * page of refusals.
 *
 * The pages themselves are listed in the sidebar (AppShell swaps the club's
 * sections for this component's when the URL is inside it), so this frame is
 * only the heading: the project's name, the edition's status, and the role
 * the club gave this person.
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

  const title = localized(access.project, 'name', locale);
  const { role } = access;

  if (!access.configured || !access.edition) {
    return (
      <>
        <PageHeader title={title} description={t('subtitle')} />
        <Alert tone="warn">{access.configured ? t('noEdition') : t('notConfigured')}</Alert>
      </>
    );
  }

  const status = access.edition.status;

  return (
    <>
      <PageHeader
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
      {children}
    </>
  );
}
