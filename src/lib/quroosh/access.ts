import 'server-only';
import { cache } from 'react';
import { getMyMember, type MyMember } from '@/lib/auth/session';
import { getMyComponentAccess } from '@/lib/interviews/access';

/**
 * Who may open a project's Quroosh (قروش) component, and as what (0074).
 * Until the club decides its own roles it follows Outreach:
 *
 *   manager  whoever holds projects.manage over the project
 *   member   on the project
 *   viewer   may see the project's KPI
 *
 * The club database answers through `my_component_access()`; this file only
 * reads the answer.
 */
export type QurooshRole = 'manager' | 'member' | 'viewer';

export type QurooshAccess = {
  role: QurooshRole;
  project: { id: string; name_en: string; name_ar: string };
  me: MyMember;
};

export const getQurooshAccess = cache(
  async (projectId: string): Promise<QurooshAccess | null> => {
    const [rows, me] = await Promise.all([getMyComponentAccess(), getMyMember()]);
    const row = rows.find((r) => r.project_id === projectId && r.component_key === 'quroosh');
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
  manage: (role: QurooshRole) => role === 'manager',
};
