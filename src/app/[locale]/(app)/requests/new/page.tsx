import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { EmptyState, PageHeader } from '@/components/ui';
import { NewRequestForm, type RequestTypeOption } from './NewRequestForm';

export default async function NewRequestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('requests');
  const supabase = await createClient();

  // Types, their forms, and their routing all come from the database. Nothing
  // in this page knows the name of a single request type.
  const [{ data: types }, { data: teams }, { data: projects }] = await Promise.all([
    supabase
      .from('request_types')
      .select('id, key, name_en, name_ar, description_en, description_ar, owning_team_id, field_schema')
      .eq('is_active', true)
      .order('name_en'),
    supabase.from('teams').select('id, name_en, name_ar').eq('is_active', true).order('name_en'),
    supabase.from('projects').select('id, name_en, name_ar').order('name_en'),
  ]);

  return (
    <>
      <PageHeader title={t('newRequest')} description={t('subtitle')} />

      {types?.length ? (
        <NewRequestForm
          types={types as unknown as RequestTypeOption[]}
          teams={(teams ?? []) as { id: string; name_en: string; name_ar: string }[]}
          projects={(projects ?? []) as { id: string; name_en: string; name_ar: string }[]}
        />
      ) : (
        <EmptyState>{t('empty')}</EmptyState>
      )}
    </>
  );
}
