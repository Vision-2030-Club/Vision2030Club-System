import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, scopeFor } from '@/lib/auth/session';
import { Card, PageHeader } from '@/components/ui';
import { localized, toDateTimeInput } from '@/lib/format';
import { NewEntryForm, type Option } from './NewEntryForm';

export default async function NewCalendarEntryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('calendar');
  const supabase = await createClient();
  const me = await getMyMember();

  /*
   * The scope on calendar.manage decides what can be scheduled directly.
   * Anything not offered here is not forbidden — it is a Meeting Request,
   * which reaches the calendar through the approval hook instead.
   */
  const scope = await scopeFor('calendar.manage');

  const [{ data: teams }, { data: projects }, { data: members }, { data: managed }] =
    await Promise.all([
      supabase.from('teams').select('id, name_en, name_ar').order('name_en'),
      supabase.from('projects').select('id, name_en, name_ar').order('name_en'),
      supabase.from('members').select('id, name_en, name_ar').order('name_en'),
      me
        ? supabase
            .from('project_managers')
            .select('projects(id, name_en, name_ar)')
            .eq('member_id', me.id)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

  const toOptions = (rows: unknown[] | null | undefined): Option[] =>
    (rows ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return { id: String(record.id), label: localized(record, 'name', locale) };
    });

  const allTeams = toOptions(teams);
  const allProjects = toOptions(projects);
  const allMembers = toOptions(members);

  const managedProjects = toOptions(
    (managed ?? []).map((row) => (row as { projects: unknown }).projects).filter(Boolean),
  );

  const myTeam = allTeams.filter((team) => team.id === me?.team_id);

  // Mirrors what app.can will decide on insert, so the form does not offer a
  // choice the database is going to refuse.
  const scopeTeams = scope === 'all' ? allTeams : scope === 'own_team' ? myTeam : [];
  const scopeProjects =
    scope === 'all' ? allProjects : scope === 'own_projects' ? managedProjects : [];

  const now = new Date();
  const inAnHour = new Date(now.getTime() + 60 * 60 * 1000);

  return (
    <>
      <PageHeader title={t('newEntry')} description={t('subtitle')} />

      <Card className="max-w-2xl">
        <NewEntryForm
          locale={locale}
          canCreateClubEvent={scope === 'all'}
          scopeTeams={scopeTeams}
          scopeProjects={scopeProjects}
          canMeetPresidency={scope === 'all'}
          teams={allTeams}
          projects={allProjects}
          members={allMembers}
          defaultStart={toDateTimeInput(now)}
          defaultEnd={toDateTimeInput(inAnHour)}
        />
      </Card>
    </>
  );
}
