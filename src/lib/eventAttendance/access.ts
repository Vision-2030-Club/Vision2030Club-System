import 'server-only';
import { cache } from 'react';
import { getMyMember, type MyMember } from '@/lib/auth/session';
import { getMyComponentAccess } from '@/lib/interviews/access';

/**
 * Who may open a project's Event attendance component, and as what (0075).
 *
 *   manager  whoever holds projects.manage over the project: everything
 *   scanner  every active member of the HR team: the gate only (the scanner,
 *            finding an attendee by name or mobile, undoing a check-in)
 *
 * The club database answers through `my_component_access()`; this file only
 * reads the answer. Every `event_*` function checks the role again itself,
 * so a page that forgets to ask is still refused.
 */
export type EventAttendanceRole = 'manager' | 'scanner';

export type EventAttendanceAccess = {
  role: EventAttendanceRole;
  project: { id: string; name_en: string; name_ar: string };
  me: MyMember;
};

export const COMPONENT_KEY = 'event_attendance';

export const getEventAttendanceAccess = cache(
  async (projectId: string): Promise<EventAttendanceAccess | null> => {
    const [rows, me] = await Promise.all([getMyComponentAccess(), getMyMember()]);
    const row = rows.find((r) => r.project_id === projectId && r.component_key === COMPONENT_KEY);
    if (!row || !me) return null;
    if (row.role !== 'manager' && row.role !== 'scanner') return null;
    return {
      role: row.role,
      project: { id: row.project_id, name_en: row.name_en, name_ar: row.name_ar },
      me,
    };
  },
);

/** What each role may do. Pages hide; the database refuses. */
export const can = {
  manage: (role: EventAttendanceRole) => role === 'manager',
  /** Both roles work the gate. */
  scan: (role: EventAttendanceRole) => role === 'manager' || role === 'scanner',
};
