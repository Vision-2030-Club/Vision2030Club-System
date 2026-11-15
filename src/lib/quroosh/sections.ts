import type { NavIconName } from '@/components/NavIcons';

/**
 * The Quroosh event's four working sections, in the order of the event:
 * the development days (21–24 Nov), the deal room (25), the final wave on
 * stage (26), and the platform's settings.
 *
 * Each section is one sidebar item and one folder of its own, so a teammate
 * can own a section without touching anyone else's files:
 *
 *   pages        src/app/[locale]/(app)/projects/[id]/quroosh/<path>/
 *   its code     src/lib/quroosh/<path>/   (create it with the first loader)
 *   its words    quroosh.<key> in messages/en.json and messages/ar.json
 *
 * The sidebar (the Quroosh shell in (app)/layout.tsx) reads this list, so a
 * section's screens are added inside its folder and never need the layout.
 * Which screens of the platform PDF belong to which section is in
 * docs/quroosh.md.
 */
export type QurooshSectionKey = 'eventDay' | 'dealRoom' | 'stage' | 'settings';

export type QurooshSection = {
  key: QurooshSectionKey;
  /** The folder and URL segment under projects/[id]/quroosh/. */
  path: string;
  icon: NavIconName;
};

export const QUROOSH_SECTIONS: readonly QurooshSection[] = [
  { key: 'eventDay', path: 'event-day', icon: 'attendance' },
  { key: 'dealRoom', path: 'deal-room', icon: 'company' },
  { key: 'stage', path: 'stage', icon: 'stage' },
  { key: 'settings', path: 'settings', icon: 'admin' },
];
