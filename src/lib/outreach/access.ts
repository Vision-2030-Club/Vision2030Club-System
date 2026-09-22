import 'server-only';
import { cache } from 'react';
import { getMyMember, PermissionError, type MyMember } from '@/lib/auth/session';
import { getMyComponentAccess } from '@/lib/interviews/access';

/**
 * Who may open a project's Outreach component, and as what (0065):
 *
 *   manager  whoever holds projects.manage over the project — everything
 *   member   on the project — adds targets, changes their own
 *   viewer   may see the project's KPI — reads the numbers, changes nothing
 *
 * The club database answers through `my_component_access()`; this file only
 * reads the answer. The policies on outreach_* re-check every write.
 */
export type OutreachRole = 'manager' | 'member' | 'viewer';

export type OutreachAccess = {
  role: OutreachRole;
  project: { id: string; name_en: string; name_ar: string };
  me: MyMember;
};

export const getOutreachAccess = cache(
  async (projectId: string): Promise<OutreachAccess | null> => {
    const [rows, me] = await Promise.all([getMyComponentAccess(), getMyMember()]);
    const row = rows.find((r) => r.project_id === projectId && r.component_key === 'outreach');
    if (!row || !me) return null;
    if (row.role !== 'manager' && row.role !== 'member' && row.role !== 'viewer') return null;
    return {
      role: row.role,
      project: { id: row.project_id, name_en: row.name_en, name_ar: row.name_ar },
      me,
    };
  },
);

/** What each role may do. Pages hide; the database refuses. */
export const can = {
  manage: (role: OutreachRole) => role === 'manager',
  add: (role: OutreachRole) => role === 'manager' || role === 'member',
  /** Change a target: managers any, members their own. The policy decides. */
  edit: (role: OutreachRole, target: { owner_id: string | null }, me: string) =>
    role === 'manager' || (role === 'member' && target.owner_id === me),
};

export async function requireOutreachAccess(
  projectId: string,
  allowed: (role: OutreachRole) => boolean,
): Promise<OutreachAccess> {
  const access = await getOutreachAccess(projectId);
  if (!access) throw new PermissionError('outreach.open');
  if (!allowed(access.role)) throw new PermissionError(`outreach.${access.role}`);
  return access;
}
