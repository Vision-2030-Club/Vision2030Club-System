import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { scopeFor } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { Card, EmptyState, Input, Label, PageHeader } from '@/components/ui';
import type { SemesterSettings } from '@/lib/semester';
import { updateSemesterAction } from './actions';

export default async function AdminSemesterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');

  /*
   * `semester_settings_update` refuses the write to anyone without club scope
   * on the calendar, so this check adds no security — it gives a readable
   * page instead of a form that fails on save.
   */
  if ((await scopeFor('calendar.manage')) !== 'all') {
    return (
      <>
        <PageHeader title={t('semester')} description={t('semesterHint')} />
        <EmptyState>{tCommon('notPermitted')}</EmptyState>
      </>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from('semester_settings')
    .select('name_en, name_ar, starts_on, ends_on')
    .eq('id', true)
    .maybeSingle();

  // Absent until migration 0067 is applied; the form then shows empty fields
  // and the save reports what the database said.
  const semester = (data ?? null) as SemesterSettings | null;

  return (
    <>
      <PageHeader title={t('semester')} description={t('semesterHint')} />

      <Card className="max-w-2xl">
        <ActionForm action={updateSemesterAction} submitLabel={tCommon('save')}>
          <input type="hidden" name="locale" value={locale} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="name_en">{t('semesterName')} (EN)</Label>
              <Input id="name_en" name="name_en" defaultValue={semester?.name_en ?? ''} required />
            </div>
            <div>
              <Label htmlFor="name_ar">{t('semesterName')} (AR)</Label>
              <Input
                id="name_ar"
                name="name_ar"
                dir="rtl"
                defaultValue={semester?.name_ar ?? ''}
                required
              />
            </div>
            <div>
              <Label htmlFor="starts_on">{t('semesterStarts')}</Label>
              <Input
                id="starts_on"
                name="starts_on"
                type="date"
                dir="ltr"
                defaultValue={semester?.starts_on ?? ''}
                required
              />
            </div>
            <div>
              <Label htmlFor="ends_on">{t('semesterEnds')}</Label>
              <Input
                id="ends_on"
                name="ends_on"
                type="date"
                dir="ltr"
                defaultValue={semester?.ends_on ?? ''}
                required
              />
            </div>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
