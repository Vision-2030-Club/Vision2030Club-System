/**
 * Shared vocabulary for room booking (§4, §6).
 *
 * Presentation and plumbing only — every rule that matters is in the database:
 * `room_bookings_no_overlap` stops double-booking, `app.validate_room_booking`
 * enforces the operating hours, and `room_bookings_insert` decides who may
 * book as whom. Nothing here re-checks any of that.
 */

/** Remembers "booking as ___" between visits (§4). */
export const IDENTITY_COOKIE = 'room_booking_identity';

export type PartyKind = 'team' | 'project' | 'presidency' | 'block';
export type BookingStatus = 'held' | 'booked' | 'blocked';

/**
 * Who a booking is for, encoded as ONE string.
 *
 * A cookie and a form field can each carry one value, so packing the kind and
 * the id together means there is never a half-set identity to guard against.
 */
export type Identity = {
  /** `presidency` · `team:<uuid>` · `project:<uuid>` */
  value: string;
  label: string;
  party_kind: 'team' | 'project' | 'presidency';
  team_id: string | null;
  project_id: string | null;
};

export function parseIdentity(value: string): Omit<Identity, 'label'> | null {
  if (value === 'presidency') {
    return { value, party_kind: 'presidency', team_id: null, project_id: null };
  }
  const separator = value.indexOf(':');
  if (separator === -1) return null;

  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!id) return null;

  if (kind === 'team') return { value, party_kind: 'team', team_id: id, project_id: null };
  if (kind === 'project') return { value, party_kind: 'project', team_id: null, project_id: id };
  return null;
}

/** One row of the schedule grid. */
export type Slot = {
  /** Minutes from midnight, on the club's clock. */
  minute: number;
  label: string;
};

/** Every half-hour start between opening and closing (§4). */
export function buildSlots(opensMinute: number, closesMinute: number): Slot[] {
  const slots: Slot[] = [];
  // `< closes` rather than `<=`: the last slot STARTS half an hour before
  // closing, because a booking beginning at closing time has nowhere to go.
  for (let minute = opensMinute; minute < closesMinute; minute += 30) {
    const hours = Math.floor(minute / 60);
    const minutes = minute % 60;
    slots.push({
      minute,
      label: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    });
  }
  return slots;
}

export type BookingView = {
  id: string;
  room_id: string;
  status: BookingStatus;
  party_kind: PartyKind;
  title: string;
  /** Already localised by the page — the grid does no lookups of its own. */
  partyLabel: string;
  bookedByName: string;
  bookedById: string;
  startMinute: number;
  endMinute: number;
};

/**
 * What the grid shows in one room's column, one slot at a time.
 *
 * `covered` is the second half of an hour-long booking: the booking itself is
 * drawn once, spanning both rows, so the row underneath it renders nothing.
 * Without it a one-hour booking would either be drawn twice or leave a gap
 * that looks bookable.
 */
export type Cell =
  | { kind: 'free'; minute: number; canBookHour: boolean }
  | { kind: 'busy'; booking: BookingView; span: number }
  | { kind: 'covered' };

/**
 * Lay one room's bookings onto the slot grid.
 *
 * Bookings can only start and end on the half hour (the database enforces
 * that), so a slot is either the start of one, inside one, or free.
 */
export function buildColumn(
  slots: Slot[],
  bookings: BookingView[],
  closesMinute: number,
): Cell[] {
  const startingAt = new Map(bookings.map((booking) => [booking.startMinute, booking]));
  const cells: Cell[] = [];
  let coveredUntil = -1;

  for (const slot of slots) {
    if (slot.minute < coveredUntil) {
      cells.push({ kind: 'covered' });
      continue;
    }

    const booking = startingAt.get(slot.minute);
    if (booking) {
      coveredUntil = booking.endMinute;
      cells.push({
        kind: 'busy',
        booking,
        span: Math.max(1, (booking.endMinute - booking.startMinute) / 30),
      });
      continue;
    }

    /*
     * §4: an hour that would run into a taken block or past closing is offered
     * as unavailable with a reason, rather than silently missing. The next
     * half-hour has to be free AND the hour has to finish by closing time.
     */
    const nextTaken = bookings.some(
      (other) => other.startMinute === slot.minute + 30,
    );
    cells.push({
      kind: 'free',
      minute: slot.minute,
      canBookHour: !nextTaken && slot.minute + 60 <= closesMinute,
    });
  }

  return cells;
}
