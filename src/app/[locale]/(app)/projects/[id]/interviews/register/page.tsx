import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, EmptyState } from '@/components/ui';
import { localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { resolveApplyFields } from '@/lib/interviews/applyFields';
import { fullCompanyIds } from '@/lib/interviews/fullCompanies';
import { loadCompanies } from '@/lib/interviews/queries';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { RegisterForm } from './RegisterForm';

/**
 * Registering a student by hand — a walk-in at the stand, someone who could
 * not use the public form.
 *
 * The form asks what the public form asks (the edition's questions, set on
 * the Applicants tab) and goes through the same submit_application, so every
 * rule holds: the limit on companies, one application per email, and full
 * companies (fullCompanies.ts), which stay on the grid, blurred, and cannot
 * be chosen. The public link, the questions and the companies are managed on
 * the Applicants tab.
 */
export default async function InterviewsRegisterPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition || !access.settings) notFound();
  const { edition, settings, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');

  if (!can.decide(role)) {
    return <EmptyState>{tCommon('notPermitted')}</EmptyState>;
  }

  const companies = await loadCompanies(createInterviewsClient(), edition.id);
  const full = fullCompanyIds(settings);

  return (
    <Card className="max-w-3xl">
      <h2 className="mb-1 font-semibold">{t('register.title')}</h2>
      <p className="mb-4 text-xs text-ink-muted">
        {t('register.intro')}{' '}
        <Link href={`/projects/${id}/interviews/applicants`} className="font-medium text-brand-700 hover:underline">
          {t('register.manageOnApplicants')}
        </Link>
      </p>
      {edition.status === 'archived' ? (
        <EmptyState>{t('errors.archived')}</EmptyState>
      ) : (
        <RegisterForm
          locale={locale}
          projectId={id}
          maxPreferences={settings.max_preferences}
          fields={resolveApplyFields(settings.apply_fields)}
          companies={companies
            .filter((c) => !c.is_hidden)
            .map((c) => ({
              id: c.id,
              name: localized(c, 'name', locale),
              logo_url: c.logo_url,
              is_full: full.has(c.id),
            }))}
        />
      )}
    </Card>
  );
}
