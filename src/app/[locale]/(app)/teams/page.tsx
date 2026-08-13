import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { localized } from '@/lib/format';

export default async function TeamsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('teams');
  const supabase = await createClient();

  const [{ data: teams }, { data: members }] = await Promise.all([
    supabase.from('teams').select('id, key, name_en, name_ar').order('name_en'),
    supabase
      .from('members')
      .select('id, name_en, name_ar, team_id, roles(key)')
      .eq('status', 'active'),
  ]);

  const counts = new Map<string, number>();
  const directors = new Map<string, string[]>();

  for (const member of members ?? []) {
    const teamId = member.team_id as string;
    counts.set(teamId, (counts.get(teamId) ?? 0) + 1);

    const role = member.roles as unknown as { key?: string };
    if (role?.key === 'team_director') {
      const name = locale === 'ar' ? member.name_ar : member.name_en;
      directors.set(teamId, [...(directors.get(teamId) ?? []), name as string]);
    }
  }

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      {teams?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <Card key={team.id}>
              <Link
                href={`/teams/${team.id}`}
                className="font-semibold text-brand-700 hover:underline"
              >
                {localized(team, 'name', locale)}
              </Link>
              <p className="mt-1 text-sm text-ink-muted">
                {t('memberCount', { count: counts.get(team.id as string) ?? 0 })}
              </p>
              <div className="mt-3 text-sm">
                <div className="text-xs font-medium text-ink-muted">{t('directors')}</div>
                {/* More than one person can direct the same team. */}
                {directors.get(team.id as string)?.length ? (
                  <ul className="mt-1 space-y-0.5">
                    {directors.get(team.id as string)!.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-ink-muted">{t('noDirectors')}</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState>{t('title')}</EmptyState>
      )}
    </>
  );
}
