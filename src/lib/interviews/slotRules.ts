/**
 * The interview slot rules, mirrored from the database (migrations 0012 and
 * 0017): every slot is SLOT_MINUTES long, and no slot is made across a
 * prayer break the company keeps. The database is what enforces them
 * (create_session ignores any other length and skips the company's breaks);
 * this copy only lets the forms say so and the floor grid leave the same
 * gaps. Change both together.
 */

export const SLOT_MINUTES = 20;

export type PrayerBreak = { key: 'asr' | 'maghrib'; from: string; to: string };

/** `HH:MM` on the edition's clock, start inclusive, end exclusive. */
export const PRAYER_BREAKS: ReadonlyArray<PrayerBreak> = [
  { key: 'asr', from: '15:00', to: '15:30' },
  { key: 'maghrib', from: '17:30', to: '18:00' },
];

/**
 * Whether a company keeps a break (0017). A company loaded before 0017 is
 * applied has neither column, and kept both breaks then.
 */
export function keepsBreak(
  company: { asr_break?: boolean; maghrib_break?: boolean },
  key: PrayerBreak['key'],
): boolean {
  return (key === 'asr' ? company.asr_break : company.maghrib_break) !== false;
}

function minutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** The first start at or after `m` (minutes past midnight) whose `len`-minute slot misses every break in `breaks`. */
export function nextSlotStart(m: number, len: number, breaks: ReadonlyArray<PrayerBreak> = PRAYER_BREAKS): number {
  let t = m;
  for (;;) {
    const hit = breaks
      .map(({ from, to }) => [minutes(from), minutes(to)] as const)
      .filter(([from, to]) => from < t + len && to > t)
      .map(([, to]) => to);
    if (hit.length === 0) return t;
    t = Math.max(...hit);
  }
}
