/**
 * The interview slot rules, mirrored from the database (migration 0012):
 * every slot is SLOT_MINUTES long, and no slot is made across a prayer
 * break. The database is what enforces them (create_session ignores any
 * other length and skips the breaks); this copy only lets the forms say so
 * and the floor grid leave the same gaps. Change both together.
 */

export const SLOT_MINUTES = 20;

/** `HH:MM` on the edition's clock, start inclusive, end exclusive. */
export const PRAYER_BREAKS: ReadonlyArray<readonly [string, string]> = [
  ['15:00', '15:30'],
  ['17:30', '18:00'],
];

function minutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** The first start at or after `m` (minutes past midnight) whose `len`-minute slot misses every break. */
export function nextSlotStart(m: number, len: number): number {
  let t = m;
  for (;;) {
    const hit = PRAYER_BREAKS.map(([from, to]) => [minutes(from), minutes(to)] as const)
      .filter(([from, to]) => from < t + len && to > t)
      .map(([, to]) => to);
    if (hit.length === 0) return t;
    t = Math.max(...hit);
  }
}
