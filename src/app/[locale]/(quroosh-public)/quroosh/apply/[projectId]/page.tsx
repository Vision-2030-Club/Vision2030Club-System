import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, PageHeader } from '@/components/ui';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { ApplyForm } from './ApplyForm';

/**
 * The public Quroosh application form: /quroosh/apply/<club project id>.
 * Anyone may open it. The Quroosh database's `application_form()` says
 * whether the project has a form (a manager has saved its settings on the
 * component's Applications page) and whether it takes answers.
 */
export default async function QurooshApplyPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh.apply');

  let form: { applications_open: boolean; privacy_url: string | null } | undefined;
  if (/^[0-9a-f-]{36}$/i.test(projectId) && isQurooshConfigured()) {
    const { data } = await createQurooshClient().rpc('application_form', { p_project: projectId });
    form = (data as (typeof form)[] | null)?.[0];
  }

  if (!form) {
    return <Alert tone="warn">{t('errors.not_found')}</Alert>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('intro')} />
      {form.applications_open ? (
        <ApplyForm projectId={projectId} privacyUrl={form.privacy_url} />
      ) : (
        <Alert tone="warn">{t('errors.applications_closed')}</Alert>
      )}
    </div>
  );
}
