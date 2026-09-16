import type { ReactNode, SVGProps } from 'react';

/**
 * Inline SVG nav glyphs — keeps the app dependency-free, and drawing them with
 * `currentColor` means each one picks up the link's active/idle colour for
 * free. All are on the same 24×24 grid so the list stays optically aligned.
 *
 * These are intentionally NOT mirrored in RTL: like most icon sets, the shapes
 * read as objects rather than as directional arrows, so flipping them would
 * look wrong rather than localised.
 */
export type NavIconName =
  | 'dashboard'
  | 'members'
  | 'teams'
  | 'projects'
  | 'tasks'
  | 'requests'
  | 'calendar'
  | 'assets'
  | 'attendance'
  | 'rooms'
  | 'kpi'
  | 'admin'
  | 'interviews'
  | 'menu';

const GLYPHS: Record<NavIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.75 19.25a6.25 6.25 0 0 1 12.5 0" />
      <path d="M16.25 4.9a3.5 3.5 0 0 1 0 6.2" />
      <path d="M17.6 14.6a6.2 6.2 0 0 1 3.65 4.65" />
    </>
  ),
  teams: (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1.5" />
      <rect x="2.5" y="16" width="6" height="5" rx="1.5" />
      <rect x="15.5" y="16" width="6" height="5" rx="1.5" />
      <path d="M12 8v3.25" />
      <path d="M5.5 16v-1.75a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1V16" />
    </>
  ),
  projects: (
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2a2 2 0 0 1 1.6.8l.9 1.2h7.3A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z" />
  ),
  tasks: (
    <>
      <path d="M9 4.5H7.5A2.5 2.5 0 0 0 5 7v11.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V7a2.5 2.5 0 0 0-2.5-2.5H15" />
      <rect x="9" y="2.5" width="6" height="4" rx="1.5" />
      <path d="m8.75 13.6 2.25 2.25 4.25-4.6" />
    </>
  ),
  requests: (
    <>
      <path d="M6.2 5.3A2.5 2.5 0 0 1 8.4 4h7.2a2.5 2.5 0 0 1 2.2 1.3l2.7 7.2v4a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5v-4z" />
      <path d="M3.5 12.5h4.2l1.3 2.5h6l1.3-2.5h4.2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  assets: (
    <>
      <path d="M21 8.5v7a2 2 0 0 1-1.02 1.74l-7 3.9a2 2 0 0 1-1.96 0l-7-3.9A2 2 0 0 1 3 15.5v-7a2 2 0 0 1 1.02-1.74l7-3.9a2 2 0 0 1 1.96 0l7 3.9A2 2 0 0 1 21 8.5z" />
      <path d="m3.3 7.6 8.7 4.85 8.7-4.85M12 21v-8.55" />
    </>
  ),
  attendance: (
    <>
      <circle cx="10" cy="8" r="3.75" />
      <path d="M3 20a7 7 0 0 1 11.1-5.7" />
      <path d="m14.6 18.1 2.1 2.1 4.3-4.7" />
    </>
  ),
  rooms: (
    <>
      <path d="M4 20.5V5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 16 5v15.5" />
      <path d="M2.75 20.5h18.5" />
      <path d="M16 8.5h2.5A1.5 1.5 0 0 1 20 10v10.5" />
      <circle cx="12.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  kpi: (
    <>
      <path d="M3.5 20.5h17" />
      <rect x="4.5" y="11" width="4" height="7" rx="1.25" />
      <rect x="10" y="6.5" width="4" height="11.5" rx="1.25" />
      <rect x="15.5" y="14" width="4" height="4" rx="1.25" />
    </>
  ),
  admin: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.05 14.6a1.6 1.6 0 0 0 .32 1.77l.06.06a1.95 1.95 0 1 1-2.76 2.76l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47v.17a1.95 1.95 0 1 1-3.9 0v-.09a1.6 1.6 0 0 0-1.03-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a1.95 1.95 0 1 1-2.76-2.76l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H2.9a1.95 1.95 0 1 1 0-3.9h.09a1.6 1.6 0 0 0 1.46-1.03 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.95 1.95 0 1 1 2.76-2.76l.06.06a1.6 1.6 0 0 0 1.77.32h.08a1.6 1.6 0 0 0 .97-1.47V2.9a1.95 1.95 0 1 1 3.9 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.95 1.95 0 1 1 2.76 2.76l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.47.97h.17a1.95 1.95 0 1 1 0 3.9h-.09a1.6 1.6 0 0 0-1.46.97z" />
    </>
  ),
  // Two people across a table: the mock-interview component.
  interviews: (
    <>
      <circle cx="7" cy="7.5" r="2.5" />
      <circle cx="17" cy="7.5" r="2.5" />
      <path d="M2.75 15.5a4.25 4.25 0 0 1 8.5 0" />
      <path d="M12.75 15.5a4.25 4.25 0 0 1 8.5 0" />
      <path d="M3 20.5h18" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

export function NavIcon({
  name,
  ...props
}: { name: NavIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {GLYPHS[name]}
    </svg>
  );
}
