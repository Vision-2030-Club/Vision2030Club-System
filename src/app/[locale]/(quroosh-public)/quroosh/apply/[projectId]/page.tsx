import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, PageHeader } from '@/components/ui';
import { localized } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { ApplyForm } from './ApplyForm';

/**
 * The public Quroosh application form: /quroosh/apply/<project id>.
 * Anyone may open it; `quroosh_application_form()` says whether the project
 * carries Quroosh and whether its managers have opened applications (on the
 * component's Applications page).
 */
export default async function QurooshApplyPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh.apply');

  const valid = /^[0-9a-f-]{36}$/i.test(projectId);
  const { data } = valid
    ? await (await createClient()).rpc('quroosh_application_form', { p_project: projectId })
    : { data: null };
  const form = (data as { name_en: string; name_ar: string; applications_open: boolean; privacy_url: string | null }[] | null)?.[0];

  if (!form) {
    return <Alert tone="warn">{t('errors.not_found')}</Alert>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('title', { project: localized(form, 'name', locale) })} description={t('intro')} />
      {form.applications_open ? (
        <ApplyForm projectId={projectId} privacyUrl={form.privacy_url} />
      ) : (
        <Alert tone="warn">{t('errors.applications_closed')}</Alert>
      )}
    </div>
  );
}
