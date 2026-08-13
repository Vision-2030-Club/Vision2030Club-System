import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/auth/session';
import { Badge, Card, EmptyState, Input, Numeric, PageHeader } from '@/components/ui';
import { localized } from '@/lib/format';

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('members');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();

  let query = supabase
    .from('members')
    .select(
      'id, name_en, name_ar, email, student_id, status, teams(name_en, name_ar), roles(key, name_en, name_ar)',
    )
    .order('name_en')
    .limit(300);

  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(
      `name_en.ilike.${term},name_ar.ilike.${term},email.ilike.${term},student_id.ilike.${term}`,
    );
  }

  // If the caller's role has no members.view scope, RLS returns just their own
  // row — the page needs no role check of its own.
  const { data: members } = await query;
  const canImport = await hasPermission('import.run');

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          canImport ? (
            <Link
              href="/admin/import"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {t('title')} · CSV
            </Link>
          ) : null
        }
      />

      <form className="mb-4">
        <Input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder={t('searchPlaceholder')}
          aria-label={tCommon('search')}
          className="max-w-md"
        />
      </form>

      {members?.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-muted text-start">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('name')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('role')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('team')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('studentId')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map((member) => {
                const role = member.roles as unknown as Record<string, string>;
                const team = member.teams as unknown as Record<string, string>;
                return (
                  <tr key={member.id} className="hover:bg-surface-muted">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/members/${member.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {locale === 'ar' ? member.name_ar : member.name_en}
                      </Link>
                      <div className="text-xs text-ink-muted" dir="ltr">
                        {member.email}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {/* One role per person; Directors are shown with their team. */}
                      {role?.key === 'team_director'
                        ? `${localized(role, 'name', locale)} — ${localized(team, 'name', locale)}`
                        : localized(role, 'name', locale)}
                    </td>
                    <td className="px-4 py-2.5">{localized(team, 'name', locale)}</td>
                    <td className="px-4 py-2.5">
                      <Numeric>{member.student_id}</Numeric>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={member.status === 'active' ? 'ok' : 'neutral'}>
                        {t(
                          `status${member.status.charAt(0).toUpperCase()}${member.status.slice(1)}`,
                        )}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState>{t('empty')}</EmptyState>
      )}
    </>
  );
}
