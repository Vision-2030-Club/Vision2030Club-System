import type { Stage } from '@/lib/interviews/types';

/**
 * The waiting-area screen, as a pure function.
 *
 * A name is CALLED when two things are true at once: the student has checked
 * in (stage `arrived`) and the clock has reached their appointment. It stays
 * up for `tvCallMinutes` after whichever of those came later, then leaves so
 * the screen never goes stale — and it leaves at once if an organizer moves
 * the student on. Below it is the queue of who is coming up; along the bottom,
 * every room's current state.
 *
 * No dates, no database, no locale in here, which is what makes it testable
 * from a script and identical for every viewer.
 */

export type BoardBooking = {
  booking_id: string;
  student_name: string;
  company_name_en: string;
  company_name_ar: string;
  room_name: string;
  /** ISO instants. */
  starts_at: string;
  ends_at: string;
  stage: Stage;
  arrived_at: string | null;
  stage_changed_at: string | null;
};

export type TickerItem = {
  room_name: string;
  company_name_en: string;
  company_name_ar: string;
  /** 'in_interview' with a name, 'next' with a name and time, or 'idle'. */
  state: 'in_interview' | 'next' | 'idle';
  student_name: string | null;
  starts_at: string | null;
};

export type Board = {
  /** ISO of the instant the board was computed for. */
  now: string;
  calling: BoardBooking[];
  queue: BoardBooking[];
  ticker: TickerItem[];
};

const ms = (iso: string) => new Date(iso).getTime();

/** When a student's name may first appear: their slot time, or their arrival if later. */
export function callFrom(booking: BoardBooking): number | null {
  if (booking.stage !== 'arrived' || !booking.arrived_at) return null;
  return Math.max(ms(booking.starts_at), ms(booking.arrived_at));
}

export function buildBoard(
  bookings: BoardBooking[],
  nowMs: number,
  tvCallMinutes: number,
  queueSize = 8,
): Board {
  const window = Math.max(1, tvCallMinutes) * 60_000;

  const calling = bookings
    .filter((b) => {
      const from = callFrom(b);
      return from !== null && nowMs >= from && nowMs < from + window;
    })
    .sort((a, b) => (callFrom(a) ?? 0) - (callFrom(b) ?? 0));

  const callingIds = new Set(calling.map((b) => b.booking_id));

  // Coming up: not yet called, still expected, and not long past their time.
  const grace = 15 * 60_000;
  const queue = bookings
    .filter(
      (b) =>
        !callingIds.has(b.booking_id) &&
        (b.stage === 'scheduled' || b.stage === 'arrived') &&
        ms(b.ends_at) + grace > nowMs,
    )
    .sort((a, b) => ms(a.starts_at) - ms(b.starts_at))
    .slice(0, queueSize);

  // One line per room: who is inside, or who is next.
  const byRoom = new Map<string, BoardBooking[]>();
  for (const b of bookings) {
    const list = byRoom.get(b.room_name) ?? [];
    list.push(b);
    byRoom.set(b.room_name, list);
  }

  const ticker: TickerItem[] = [...byRoom.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([room_name, list]) => {
      const inside = list.find((b) => b.stage === 'in_interview');
      const upcoming = list
        .filter((b) => (b.stage === 'scheduled' || b.stage === 'arrived') && ms(b.ends_at) > nowMs)
        .sort((a, b) => ms(a.starts_at) - ms(b.starts_at))[0];
      const sample = inside ?? upcoming ?? list[0];
      return {
        room_name,
        company_name_en: sample.company_name_en,
        company_name_ar: sample.company_name_ar,
        state: inside ? 'in_interview' : upcoming ? 'next' : 'idle',
        student_name: inside?.student_name ?? upcoming?.student_name ?? null,
        starts_at: inside?.starts_at ?? upcoming?.starts_at ?? null,
      };
    });

  return { now: new Date(nowMs).toISOString(), calling, queue, ticker };
}
