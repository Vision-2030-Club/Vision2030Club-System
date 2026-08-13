/**
 * Month-grid geometry for the calendar (spec §6).
 *
 * The one rule worth stating: a multi-day entry is ONE bar spanning the days
 * it covers, not a copy repeated on each day. That means the layout works in
 * week-sized pieces — an entry crossing a week boundary produces one bar per
 * week, each flagged so the ends can be drawn open.
 *
 * Columns are returned as 0-based offsets from the start of the week. The page
 * turns them into CSS `grid-column`, which resolves logically: under
 * `dir="rtl"` column 1 is the rightmost cell, so the same numbers lay out
 * correctly in Arabic without any mirroring here.
 */

export type CalendarEntry = {
  id: string;
  kind: 'club' | 'meeting';
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  category: string | null;
  color: string | null;
  source_request_id: string | null;
};

export type Bar = {
  entry: CalendarEntry;
  /** 0-6 offsets within the week, both inclusive. */
  startCol: number;
  endCol: number;
  /** Vertical slot, so overlapping entries stack instead of colliding. */
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type Week = {
  days: Date[];
  bars: Bar[];
  laneCount: number;
};

/** Days since the epoch in local time — the calendar's unit of "a day". */
export function dayNumber(value: Date): number {
  return Math.floor(
    (value.getTime() - value.getTimezoneOffset() * 60_000) / 86_400_000,
  );
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Parses `?month=YYYY-MM`, falling back to the current month. */
export function parseMonth(value: string | undefined, today = new Date()) {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) return { year: today.getFullYear(), month: today.getMonth() };

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) {
    return { year: today.getFullYear(), month: today.getMonth() };
  }
  return { year, month };
}

export function monthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function shiftMonth(year: number, month: number, by: number) {
  const shifted = new Date(year, month + by, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() };
}

/**
 * The full grid, padded out to whole weeks starting Sunday — the working week
 * the club actually uses.
 */
export function monthGridRange(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = addDays(first, -first.getDay());
  const end = addDays(last, 6 - last.getDay());
  return { start, end };
}

/**
 * Slices entries into per-week bars.
 *
 * An entry is placed on every day from its start to its end inclusive, so a
 * meeting ending at 09:00 on Thursday still covers Thursday.
 */
export function buildWeeks(
  year: number,
  month: number,
  entries: CalendarEntry[],
): Week[] {
  const { start, end } = monthGridRange(year, month);
  const weekCount = Math.round((dayNumber(end) - dayNumber(start) + 1) / 7);

  const spans = entries
    .map((entry) => ({
      entry,
      firstDay: dayNumber(new Date(entry.starts_at)),
      lastDay: dayNumber(new Date(entry.ends_at)),
    }))
    // Longest first, then earliest: long bars take the top lanes, which reads
    // far better than letting a one-day entry split a week-long one.
    .sort((a, b) => {
      const lengthDiff = b.lastDay - b.firstDay - (a.lastDay - a.firstDay);
      return lengthDiff !== 0 ? lengthDiff : a.firstDay - b.firstDay;
    });

  const weeks: Week[] = [];

  for (let w = 0; w < weekCount; w++) {
    const weekStart = addDays(start, w * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const weekFirst = dayNumber(weekStart);
    const weekLast = weekFirst + 6;

    const bars: Bar[] = [];
    // laneEnds[lane] = last column that lane is occupied through.
    const laneEnds: number[] = [];

    for (const span of spans) {
      if (span.lastDay < weekFirst || span.firstDay > weekLast) continue;

      const startCol = Math.max(0, span.firstDay - weekFirst);
      const endCol = Math.min(6, span.lastDay - weekFirst);

      let lane = laneEnds.findIndex((occupiedThrough) => occupiedThrough < startCol);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = endCol;

      bars.push({
        entry: span.entry,
        startCol,
        endCol,
        lane,
        continuesBefore: span.firstDay < weekFirst,
        continuesAfter: span.lastDay > weekLast,
      });
    }

    weeks.push({ days, bars, laneCount: laneEnds.length });
  }

  return weeks;
}
