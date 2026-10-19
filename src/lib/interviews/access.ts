import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { getMyMember, PermissionError, scopeFor } from '@/lib/auth/session';
import type { Edition, EditionSettings } from '@/lib/interviews/types';

/**
 * Who may open a project's component, and as what.
 *
 * The answer comes from the CLUB database — `my_component_access()` in
 * migration 0062 — because that is where the project, its managers, the HR
 * override and the roster live. The interviews database is only asked for
 * the edition once the club has said yes.
 *
 *   manager    whoever holds projects.manage over the project: its PMs, the
 *              Presidency, the Super Admin. Everything.
 *   hr         whoever holds members.manage at scope all (HR's Directors, by
 *              the 0004 override) plus the people they add. Decides per
 *              company; reads everything else.
 *   organizer  chosen by the project's managers. Moves students through the
 *              stages on the day.
 *   reception  chosen by the project's managers or HR's Directors (0069).
 *              Checks students in at the door (the Reception tab) and
 *              nothing else.
 *   member     Outreach only (0065): on the project, works its targets.
 *   viewer     Outreach: may see the project's KPI, reads the numbers.
 *              Mock Interviews (0072): the Development team, who read the
 *              visitor ratings (the Visitor feedback tab) and nothing else.
 */
export type ComponentRole = 'manager' | 'hr' | 'organizer' | 'reception' | 'member' | 'viewer';

export type ComponentAccess = {
  project_id: string;
  name_en: string;
  name_ar: string;
  component_key: string;
  external_ref: string | null;
  role: ComponentRole;
  /**
   * Also listed as a receptionist (0069) while the role above is another one.
   * my_component_access() answers only the strongest role, so an organizer
   * who is also a receptionist read as an organizer and lost the Reception
   * tab; the club wants them to have both (2026-10-20). See can.reception.
   */
  desk: boolean;
};

/** Where each component's pages live, keyed by `project_components.component_key`. */
export const COMPONENT_ROUTES: Record<string, string> = {
  mock_interviews: 'interviews',
  outreach: 'outreach',
};

export function componentHref(projectId: string, componentKey: string): string {
  return `/projects/${projectId}/${COMPONENT_ROUTES[componentKey] ?? componentKey}`;
}

/** One query per request, shared by the sidebar and every component page. */
export const getMyComponentAccess = cache(async (): Promise<ComponentAccess[]> => {
  const supabase = await createClient();
  const [{ data }, me] = await Promise.all([supabase.rpc('my_component_access'), getMyMember()]);
  const rows = (data ?? []) as Omit<ComponentAccess, 'desk'>[];
  // Where I am listed as a receptionist (readable by anyone signed in, 0062).
  const desks = new Set<string>();
  if (me && rows.some((r) => r.component_key === 'mock_interviews')) {
    const { data: listed } = await supabase
      .from('project_component_people')
      .select('project_id')
      .eq('member_id', me.id)
      .eq('role', 'reception');
    for (const row of (listed ?? []) as { project_id: string }[]) desks.add(row.project_id);
  }
  return rows.map((r) => ({ ...r, desk: desks.has(r.project_id) }));
});

/** The actor every write to the interviews database is recorded under. */
export type Actor = { kind: 'member'; id: string; name: string };

export type InterviewAccess = {
  role: ComponentRole;
  /** Also a receptionist (ComponentAccess.desk). */
  desk: boolean;
  project: { id: string; name_en: string; name_ar: string };
  /** Null when the edition is missing or the interviews project is not configured. */
  edition: Edition | null;
  settings: EditionSettings | null;
  configured: boolean;
  actor: Actor;
};

export const getInterviewAccess = cache(
  async (projectId: string): Promise<InterviewAccess | null> => {
    const [rows, me] = await Promise.all([getMyComponentAccess(), getMyMember()]);
    const row = rows.find(
      (r) => r.project_id === projectId && r.component_key === 'mock_interviews',
    );
    if (!row || !me) return null;

    const actor: Actor = { kind: 'member', id: me.id, name: me.name_en };
    const base = {
      role: row.role,
      desk: row.desk,
      project: { id: row.project_id, name_en: row.name_en, name_ar: row.name_ar },
      actor,
    };

    if (!isInterviewsConfigured() || !row.external_ref) {
      return { ...base, edition: null, settings: null, configured: isInterviewsConfigured() };
    }

    const db = createInterviewsClient();
    const [{ data: edition }, { data: settings }] = await Promise.all([
      db.from('editions').select('*').eq('id', row.external_ref).maybeSingle(),
      db.rpc('edition_settings', { p_edition: row.external_ref }),
    ]);

    return {
      ...base,
      edition: (edition as Edition | null) ?? null,
      settings: (settings as EditionSettings | null) ?? null,
      configured: true,
    };
  },
);

/** What each role may do. Pages grey out; the actions below refuse. */
export const can = {
  manage: (role: ComponentRole) => role === 'manager',
  decide: (role: ComponentRole) => role === 'manager' || role === 'hr',
  stage: (role: ComponentRole) => role === 'manager' || role === 'organizer',
  /**
   * The Reception tab: checking a student in, and undoing it. `desk`: listed
   * as a receptionist too, whatever the strongest role (an organizer who also
   * works the door, 2026-10-20).
   */
  reception: (role: ComponentRole, desk = false) =>
    role === 'manager' || role === 'hr' || role === 'reception' || desk,
  /** Adding HR people is HR's own power; the club database re-checks it. */
  roster: (role: ComponentRole) => role === 'manager' || role === 'hr',
  /** The visitor ratings: managers, HR, and the Development team (0072). */
  visitorResults: (role: ComponentRole) => role === 'manager' || role === 'hr' || role === 'viewer',
  /** Every page that shows students: everyone with a working role, not a viewer. */
  floorAccess: (role: ComponentRole) => role !== 'viewer' && role !== 'member',
};

/**
 * For server actions: resolve access and insist on a live edition. Throws a
 * PermissionError (a readable sentence) rather than reaching the database as
 * somebody with no business there.
 */
export async function requireInterviewAccess(
  projectId: string,
  allowed: (role: ComponentRole, desk: boolean) => boolean,
): Promise<InterviewAccess & { edition: Edition; settings: EditionSettings }> {
  const access = await getInterviewAccess(projectId);
  if (!access) throw new PermissionError('interviews.open');
  if (!allowed(access.role, access.desk)) throw new PermissionError(`interviews.${access.role}`);
  if (!access.edition || !access.settings) {
    throw new Error(
      access.configured
        ? 'This project has no interviews edition attached.'
        : 'The Mock Interviews database is not configured on this server.',
    );
  }
  return { ...access, edition: access.edition, settings: access.settings };
}

/**
 * Booking and rescheduling by hand (2026-10-19): the project's managers and
 * HR's Directors (members.manage at scope all), not every HR person listed on
 * the project. The Reception tab's Manual booking / Reschedule buttons and
 * the Bookings tab.
 */
export async function canSchedule(role: ComponentRole): Promise<boolean> {
  if (role === 'manager') return true;
  if (role !== 'hr') return false;
  return (await scopeFor('members.manage')) === 'all';
}
