import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getMyPermissions } from '@/lib/auth/session';
import { EmptyState, PageHeader } from '@/components/ui';
import { loadFieldOptions } from '@/lib/requests';
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
  const [{ data: types }, { data: teams }, { data: projects }, { data: members }] =
    await Promise.all([
    supabase
      .from('request_types')
      .select('id, key, name_en, name_ar, description_en, description_ar, owning_team_id, submit_permission, field_schema')
      .eq('is_active', true)
      .order('name_en'),
    supabase.from('teams').select('id, name_en, name_ar').eq('is_active', true).order('name_en'),
    supabase.from('projects').select('id, name_en, name_ar').order('name_en'),
    supabase
      .from('members')
      .select('id, name_en, name_ar')
      .eq('status', 'active')
      .order('name_en'),
  ]);

  // Only the types this person may actually submit. The database refuses the
  // others anyway (requests_insert, 0034); offering them was how a Member
  // met a permission error instead of simply not seeing "Meeting Request".
  const permissions = await getMyPermissions();
  const allowed = ((types ?? []) as unknown as (RequestTypeOption & {
    submit_permission: string | null;
  })[]).filter(
    (type) =>
      !type.submit_permission || (permissions.get(type.submit_permission) ?? 'none') !== 'none',
  );

  // Selects that read their choices from a table — today the asset catalogue.
  // Only the sources the visible types actually name are fetched.
  const fieldOptions = await loadFieldOptions(supabase, allowed);

  return (
    <>
      <PageHeader title={t('newRequest')} description={t('subtitle')} />

      {allowed.length ? (
        <NewRequestForm
          types={allowed}
          teams={(teams ?? []) as { id: string; name_en: string; name_ar: string }[]}
          projects={(projects ?? []) as { id: string; name_en: string; name_ar: string }[]}
          members={(members ?? []) as { id: string; name_en: string; name_ar: string }[]}
          fieldOptions={fieldOptions}
        />
      ) : (
        <EmptyState>{t('empty')}</EmptyState>
      )}
    </>
  );
}
