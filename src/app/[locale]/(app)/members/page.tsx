import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/auth/session';
import { Avatar } from '@/components/Avatar';
import { Badge, Card, EmptyState, Input, Numeric, PageHeader } from '@/components/ui';
import { signAvatars } from '@/lib/avatars';
import { localized } from '@/lib/format';
import { phoneSearchTerm } from '@/lib/phone';

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

  /*
   * The directory is the Presidency's and HR's screen (0048). This guard is
   * only for a readable message — RLS is what actually protects the rows, and
   * `members.view` deliberately still lets other roles read members through
   * the task, project and meeting pickers.
   */
  if (!(await hasPermission('members.directory'))) {
    return (
      <>
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState>{t('restricted')}</EmptyState>
      </>
    );
  }

  const supabase = await createClient();

  let query = supabase
    .from('members')
    .select(
      'id, name_en, name_ar, email, phone, avatar_path, status, teams(name_en, name_ar), roles(key, name_en, name_ar)',
    )
    .order('name_en')
    .limit(300);

  /*
   * Name, email, or phone (addendum §10 — the student ID is no longer a search
   * key). Phone is matched on digits alone rather than on the raw text,
   * because the column stores one canonical form: someone who types
   * `0512345678` and someone who types `+966512345678` both mean the row
   * holding `+966512345678`, and `phoneSearchTerm` reduces either to the
   * digits that sit inside it.
   */
  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    const digits = phoneSearchTerm(q);
    const filters = [
      `name_en.ilike.${term}`,
      `name_ar.ilike.${term}`,
      `email.ilike.${term}`,
    ];
    if (digits) filters.push(`phone.ilike.%${digits}%`);
    query = query.or(filters.join(','));
  }

  // If the caller's role has no members.view scope, RLS returns just their own
  // row — the page needs no role check of its own.
  const { data: members } = await query;
  const canImport = await hasPermission('import.run');
  const photos = await signAvatars(
    supabase,
    (members ?? []).map((member) => member.avatar_path as string | null),
  );

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
                {/* Addendum §10: the result row shows phone, not student ID. */}
                <th className="px-4 py-2.5 text-start font-medium">{t('phone')}</th>
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
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={
                            member.avatar_path
                              ? photos.get(member.avatar_path as string)
                              : null
                          }
                          name={locale === 'ar' ? member.name_ar : member.name_en}
                          size={36}
                        />
                        <div className="min-w-0">
                          <Link
                            href={`/members/${member.id}`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {locale === 'ar' ? member.name_ar : member.name_en}
                          </Link>
                          <div className="truncate text-xs text-ink-muted" dir="ltr">
                            {member.email}
                          </div>
                        </div>
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
                      {member.phone ? <Numeric>{member.phone}</Numeric> : '—'}
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
