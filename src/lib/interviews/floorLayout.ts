/**
 * The event's days and hours, set once per edition in Settings, so the
 * floor (the Floor tab's room view and the floor Google Sheet) can show
 * every room's time grid before any company is assigned to it. Hours a room
 * has no company for stay empty rows; once a company is assigned
 * (a session), its real slots take their place.
 *
 * Kept in the edition's settings as `floor_layout`, merged by update_edition
 * like every other setting, so it needs no migration. No `server-only`: the
 * Settings form and the floor read the same rules.
 */

export type FloorLayout = {
  /** First and last event day, `YYYY-MM-DD`, inclusive. */
  from_day: string;
  to_day: string;
  /** Daily hours on the edition's clock, `HH:MM`. */
  start: string;
  end: string;
  slot_minutes: number;
};

export const LAYOUT_SLOT_LENGTHS = [5, 10, 15, 20, 25, 30, 40, 45, 60];
/** A guard against a typo turning one week into a year of empty tabs. */
export const MAX_LAYOUT_DAYS = 14;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** The days from `from` to `to`, inclusive; empty if `to` is before `from`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end && out.length <= MAX_LAYOUT_DAYS; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Why a layout cannot be saved (a key under interviews.layout.errors), or null when it is fine. */
export function layoutProblem(l: FloorLayout): string | null {
  if (!DAY.test(l.from_day) || !DAY.test(l.to_day)) return 'badDay';
  const days = daysBetween(l.from_day, l.to_day).length;
  if (days === 0) return 'daysBackwards';
  if (days > MAX_LAYOUT_DAYS) return 'tooManyDays';
  if (!TIME.test(l.start) || !TIME.test(l.end)) return 'badTime';
  if (minutes(l.end) <= minutes(l.start)) return 'endBeforeStart';
  if (!LAYOUT_SLOT_LENGTHS.includes(l.slot_minutes)) return 'badSlot';
  return null;
}

/** The edition's layout, or null when none was set (or what is stored is unusable). */
export function floorLayout(settings: { floor_layout?: unknown } | null | undefined): FloorLayout | null {
  const raw = settings?.floor_layout as Partial<FloorLayout> | null | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const layout: FloorLayout = {
    from_day: String(raw.from_day ?? ''),
    to_day: String(raw.to_day ?? ''),
    start: String(raw.start ?? ''),
    end: String(raw.end ?? ''),
    slot_minutes: Number(raw.slot_minutes),
  };
  return layoutProblem(layout) ? null : layout;
}

export function layoutDays(layout: FloorLayout | null): string[] {
  return layout ? daysBetween(layout.from_day, layout.to_day) : [];
}

/** How far `zone` is ahead of UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asIfUtc - instant.getTime();
}

/** `day` at `minute` past midnight on `zone`'s clock, as an ISO instant. */
function wallClock(day: string, minute: number, zone: string): string {
  const naive = new Date(Date.parse(`${day}T00:00:00Z`) + minute * 60_000);
  return new Date(naive.getTime() - zoneOffsetMs(naive, zone)).toISOString();
}

/** The start of every grid row on `day`: `start`, then every `slot_minutes`, before `end`. */
export function gridTimes(layout: FloorLayout, day: string, zone: string): string[] {
  const out: string[] = [];
  for (let m = minutes(layout.start); m + layout.slot_minutes <= minutes(layout.end); m += layout.slot_minutes) {
    out.push(wallClock(day, m, zone));
  }
  return out;
}

export type FloorEntry<S> = { kind: 'slot'; slot: S; starts_at: string } | { kind: 'empty'; starts_at: string };

/**
 * One room's day as rows: its real slots (from whichever companies are
 * assigned to it), plus an empty row for every grid time no slot covers.
 * A grid time is covered when a slot is running at that moment, so a
 * company with 15-minute slots in a 20-minute grid shows its own times.
 */
export function roomDay<S extends { starts_at: string; ends_at: string }>(slots: S[], grid: string[]): FloorEntry<S>[] {
  const entries: FloorEntry<S>[] = slots.map((slot) => ({ kind: 'slot', slot, starts_at: slot.starts_at }));
  for (const time of grid) {
    const t = Date.parse(time);
    const covered = slots.some((s) => Date.parse(s.starts_at) <= t && t < Date.parse(s.ends_at));
    if (!covered) entries.push({ kind: 'empty', starts_at: time });
  }
  return entries.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}
