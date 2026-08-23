/**
 * The club's clock.
 *
 * Everything with an hour on it — the calendar, the room schedule, a task's
 * due date — is shown on this clock, not on whatever timezone the server
 * happens to run in. That mattered enough to be a real bug: migration 0027 was
 * written because the database runs in UTC, so a 13:00 Riyadh booking arrived
 * as 10:00 and was refused for being before opening hours.
 *
 * There are deliberately two copies of this value and one test that keeps them
 * honest:
 *
 *   - `booking_settings.time_zone` in the database, because the booking
 *     trigger cannot read a TypeScript file.
 *   - `CLUB_TIME_ZONE` here, because `formatDate` is a plain synchronous
 *     function used in dozens of places and should not need a database query.
 *
 * `npm run db:rooms` asserts they are equal, so if one is changed and the
 * other is not, a test fails rather than the app quietly showing times three
 * hours out.
 */
export const CLUB_TIME_ZONE = 'Asia/Riyadh';

/**
 * Wall-clock parts of an instant, as the club would read them.
 *
 * `en-CA` is used purely because its date format is already `YYYY-MM-DD`,
 * which saves reassembling the pieces by hand.
 */
function clubParts(value: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(value)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  // Midnight comes back as "24" in some ICU versions; normalise it.
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

/** `2026-08-22` on the club's clock, for `<input type="date">`. */
export function toDateInput(value: Date): string {
  const p = clubParts(value);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `2026-08-22T14:30` on the club's clock, for `<input type="datetime-local">`. */
export function toDateTimeInput(value: Date): string {
  const p = clubParts(value);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * A date-and-time the club typed, as an unambiguous instant for the database.
 *
 * Postgres accepts a zone NAME inside a timestamp literal, so rather than
 * doing offset arithmetic in JavaScript — which has to know about daylight
 * saving and gets it wrong sooner or later — we hand the whole thing over and
 * let Postgres resolve it. `2026-08-22 14:00:00 Asia/Riyadh` means the same
 * instant no matter where this code or the database is running.
 *
 * @param day  `YYYY-MM-DD`
 * @param time `HH:MM`
 */
export function clubTimestamp(day: string, time: string, zone = CLUB_TIME_ZONE): string {
  return `${day} ${time}:00 ${zone}`;
}

/** `2026-08-22` plus n days, staying on the club's calendar. */
export function addDaysToDateInput(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  // Built at UTC noon so adding days can never trip over a daylight-saving
  // change and land on the wrong date.
  const shifted = new Date(Date.UTC(year, month - 1, date + days, 12));
  return shifted.toISOString().slice(0, 10);
}

/** Minutes from midnight — the unit `booking_settings` stores hours in. */
export function minuteLabel(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * How far ahead of UTC the club's clock is at a given instant, in ms.
 *
 * There is no built-in way to ask this, so the trick is: format the instant in
 * the club's zone, read the pieces back as if they were UTC, and the
 * difference is the offset. Riyadh has no daylight saving, so for this club it
 * is always +3 — but doing it this way means the code stays right if the club
 * setting is ever changed to a zone that does.
 */
function zoneOffsetMs(instant: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CLUB_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }

  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second,
  );
  return asIfUtc - instant.getTime();
}

/**
 * A wall-clock reading the club typed, as a real instant.
 *
 * `<input type="datetime-local">` gives `2026-08-22T14:00` with no timezone at
 * all, and `new Date()` on that string quietly uses whatever zone the SERVER
 * runs in — Riyadh on a laptop, UTC in production, so the same form would
 * store two different times. This anchors it to the club's clock instead.
 */
export function fromClubWallClock(local: string): Date {
  // Read the wall clock as if it were UTC, then shift by the club's offset at
  // that moment. Two steps, because the offset depends on the instant.
  const naive = new Date(`${local.length === 16 ? `${local}:00` : local}Z`);
  return new Date(naive.getTime() - zoneOffsetMs(naive));
}
