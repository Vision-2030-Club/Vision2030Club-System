import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, PageHeader } from '@/components/ui';
import { asLocale, publicSections } from '@/lib/quroosh/form';
import { loadForm, requestCatalog } from '@/lib/quroosh/loadForm';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { ApplyForm } from './ApplyForm';

/**
 * The public Quroosh application form: /quroosh/apply/<club project id>.
 * Anyone may open it. The Quroosh database's `application_form()` says
 * whether the project has a form (a manager has saved its settings on the
 * component's Applications page) and whether it takes answers. The questions
 * are the project's, as its managers edited them (Quroosh 0004, loadForm).
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
  const quroosh = /^[0-9a-f-]{36}$/i.test(projectId) && isQurooshConfigured() ? createQurooshClient() : null;
  if (quroosh) {
    const { data } = await quroosh.rpc('application_form', { p_project: projectId });
    form = (data as (typeof form)[] | null)?.[0];
  }

  if (!form || !quroosh) {
    return <Alert tone="warn">{t('errors.not_found')}</Alert>;
  }
  const sections = form.applications_open
    ? publicSections((await loadForm(quroosh, projectId)).form, asLocale(locale), await requestCatalog(locale))
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('intro')} />
      {form.applications_open ? (
        <ApplyForm projectId={projectId} privacyUrl={form.privacy_url} sections={sections} />
      ) : (
        <Alert tone="warn">{t('errors.applications_closed')}</Alert>
      )}
    </div>
  );
}
