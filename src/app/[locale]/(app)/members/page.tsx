import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, hasPermission, scopeFor } from '@/lib/auth/session';
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
   * Three directories, by scope (0048, 0058):
   *
   *   all           the Presidency's and HR's — everyone, with contact
   *                 details and a link to each profile
   *   own_team      a Director's — their team, names only
   *   own_projects  a Project Manager's — the people on their projects,
   *                 names only
   *
   * This guard is only for a readable message and the right shape — RLS is
   * what protects the rows, and `members.view` deliberately still lets other
   * roles read members through the task, project and meeting pickers.
   */
  const scope = await scopeFor('members.directory');
  if (scope === 'none') {
    return (
      <>
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState>{t('restricted')}</EmptyState>
      </>
    );
  }
  const full = scope === 'all';

  const supabase = await createClient();
  const me = await getMyMember();

  // One literal select — supabase-js types the row by parsing it, and a
  // conditional string defeats that. What a names-only viewer is NOT shown
  // is decided below, in the markup; `members.view` lets every role read
  // these columns anyway (0048), so fetching them hides nothing.
  let query = supabase
    .from('members')
    .select(
      'id, name_en, name_ar, email, phone, avatar_path, status, teams(name_en, name_ar), roles(key, name_en, name_ar)',
    )
    .order('name_en')
    .limit(300);

  if (scope === 'own_team') {
    query = query.eq('team_id', me!.team_id);
  } else if (scope === 'own_projects') {
    const { data: managed } = await supabase
      .from('project_managers')
      .select('project_id')
      .eq('member_id', me!.id);
    const projectIds = (managed ?? []).map((p) => p.project_id as string);
    const { data: staffed } = projectIds.length
      ? await supabase.from('project_members').select('member_id').in('project_id', projectIds)
      : { data: [] as { member_id: string }[] };
    const ids = [...new Set((staffed ?? []).map((s) => s.member_id as string))];
    query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  }

  /*
   * Name, email, or phone (addendum §10 — the student ID is no longer a search
   * key). Phone is matched on digits alone rather than on the raw text,
   * because the column stores one canonical form: someone who types
   * `0512345678` and someone who types `+966512345678` both mean the row
   * holding `+966512345678`, and `phoneSearchTerm` reduces either to the
   * digits that sit inside it. A names-only directory searches names only.
   */
  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    const filters = [`name_en.ilike.${term}`, `name_ar.ilike.${term}`];
    if (full) {
      filters.push(`email.ilike.${term}`);
      const digits = phoneSearchTerm(q);
      if (digits) filters.push(`phone.ilike.%${digits}%`);
    }
    query = query.or(filters.join(','));
  }

  const { data: members } = await query;
  const canImport = full && (await hasPermission('import.run'));
  const photos = await signAvatars(
    supabase,
    (members ?? []).map((member) => member.avatar_path as string | null),
  );

  type Row = {
    id: string;
    name_en: string;
    name_ar: string;
    email?: string;
    phone?: string | null;
    avatar_path: string | null;
    status: string;
    teams: Record<string, string> | null;
    roles: Record<string, string> | null;
  };
  const rows = (members ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={full ? t('subtitle') : t('namesOnly')}
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
          placeholder={full ? t('searchPlaceholder') : t('name')}
          aria-label={tCommon('search')}
          className="max-w-md"
        />
      </form>

      {rows.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-muted text-start">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('name')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('role')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('team')}</th>
                {/* Addendum §10: the result row shows phone, not student ID. */}
                {full ? (
                  <th className="px-4 py-2.5 text-start font-medium">{t('phone')}</th>
                ) : null}
                <th className="px-4 py-2.5 text-start font-medium">{t('status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((member) => {
                const name = locale === 'ar' ? member.name_ar : member.name_en;
                return (
                  <tr key={member.id} className="hover:bg-surface-muted">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={member.avatar_path ? photos.get(member.avatar_path) : null}
                          name={name}
                          size={36}
                        />
                        <div className="min-w-0">
                          {full ? (
                            <Link
                              href={`/members/${member.id}`}
                              className="font-medium text-brand-700 hover:underline"
                            >
                              {name}
                            </Link>
                          ) : (
                            <span className="font-medium">{name}</span>
                          )}
                          {full && member.email ? (
                            <div className="truncate text-xs text-ink-muted" dir="ltr">
                              {member.email}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {/* One role per person; Directors are shown with their team. */}
                      {member.roles?.key === 'team_director'
                        ? `${localized(member.roles, 'name', locale)} — ${localized(member.teams, 'name', locale)}`
                        : localized(member.roles, 'name', locale)}
                    </td>
                    <td className="px-4 py-2.5">{localized(member.teams, 'name', locale)}</td>
                    {full ? (
                      <td className="px-4 py-2.5">
                        {member.phone ? <Numeric>{member.phone}</Numeric> : '—'}
                      </td>
                    ) : null}
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
