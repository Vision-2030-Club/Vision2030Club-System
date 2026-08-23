import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, scopeFor } from '@/lib/auth/session';
import { localized } from '@/lib/format';
import type { Option } from './EntryForm';

/**
 * Everything the entry form needs to render its selects, plus the limits its
 * scope control has to respect.
 *
 * Both /calendar/new and /calendar/[id] ask for exactly the same set, so it
 * lives here rather than being copied — and more importantly so the *rule*
 * lives in one place: the scope on `calendar.manage` decides what may be
 * scheduled directly, and anything not offered is a Meeting Request rather
 * than something forbidden.
 */
export type EntryFormOptions = {
  canCreateClubEvent: boolean;
  scopeTeams: Option[];
  scopeProjects: Option[];
  canMeetPresidency: boolean;
  teams: Option[];
  projects: Option[];
  members: Option[];
};

export async function loadEntryFormOptions(locale: string): Promise<EntryFormOptions> {
  const supabase = await createClient();
  const me = await getMyMember();
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

  // Mirrors what app.can will decide on write, so the form does not offer a
  // choice the database is going to refuse.
  return {
    canCreateClubEvent: scope === 'all',
    scopeTeams: scope === 'all' ? allTeams : scope === 'own_team' ? myTeam : [],
    scopeProjects: scope === 'all' ? allProjects : scope === 'own_projects' ? managedProjects : [],
    canMeetPresidency: scope === 'all',
    teams: allTeams,
    projects: allProjects,
    members: allMembers,
  };
}
