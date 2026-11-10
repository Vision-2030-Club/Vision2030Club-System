import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, PageHeader } from '@/components/ui';
import { localized } from '@/lib/format';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import type { FormQuestion } from '@/lib/quroosh/form';
import { fileCatalog, loadForm } from '@/lib/quroosh/loadForm';
import { SECTION_KEYS } from '@/lib/quroosh/questions';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { QuestionsEditor, type DefaultWording } from './QuestionsEditor';

/**
 * The project's application questions, for its managers (Quroosh 0004): add
 * questions, edit them, hide them, reorder them. Opened from the
 * Applications page. The form's own questions show the catalog's wording
 * until a manager writes their own; that default is passed to the editor so
 * each field shows what it replaces.
 */
export default async function QurooshQuestionsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getQurooshAccess(id);
  if (!access || !can.manage(access.role)) notFound();

  const t = await getTranslations('quroosh');
  const header = (
    <PageHeader
      title={t('questions.title')}
      description={localized(access.project, 'name', locale)}
      back={{ href: `/projects/${id}/quroosh/applications`, label: t('applications.title') }}
    />
  );
  if (!isQurooshConfigured()) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('applications.notConfigured')}</Alert>
      </>
    );
  }

  const { form, editable } = await loadForm(createQurooshClient(), id);
  const en = fileCatalog('en');
  const ar = fileCatalog('ar');
  const defaults: Record<string, DefaultWording> = Object.fromEntries(
    form
      .filter((q: FormQuestion) => q.builtin)
      .map((q) => {
        const hintKey = q.kind === 'consent' ? `consent.${q.key}` : `hint.${q.key}`;
        return [
          q.key,
          {
            label: { en: en(`q.${q.key}`), ar: ar(`q.${q.key}`) },
            hint: { en: en(hintKey), ar: ar(hintKey) },
            options: Object.fromEntries(
              q.options.map((o) => [o.value, { en: en(`options.${q.key}.${o.value}`), ar: ar(`options.${q.key}.${o.value}`) }]),
            ),
          },
        ];
      }),
  );
  const sectionTitles = Object.fromEntries(SECTION_KEYS.map((key) => [key, t(`apply.sections.${key}`)]));

  return (
    <div className="space-y-6">
      {header}
      <Alert tone="info">{t('questions.intro')}</Alert>
      {editable ? null : <Alert tone="warn">{t('questions.notReady')}</Alert>}
      <QuestionsEditor
        projectId={id}
        locale={locale}
        form={form}
        defaults={defaults}
        sectionTitles={sectionTitles}
        editable={editable}
      />
    </div>
  );
}
