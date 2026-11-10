import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CLUB_TIME_ZONE, toDateInput } from '@/lib/time';
import type { QurooshGuestInvitation, QurooshGuestSlot } from './types';

/**
 * Guest invitations and their bookings (Quroosh 0005): the project's managers
 * offer times (slots), invite guests, and each guest books one slot on their
 * own link. One guest per slot; the database makes that so.
 *
 * Every time is shown on the club's clock (Asia/Riyadh), never the viewer's:
 * guests may open their link from abroad. The formatters in src/lib/format.ts
 * and the helpers below are all pinned to CLUB_TIME_ZONE.
 */

/** Every guest session is this long; slots store only their start. */
export const GUEST_SESSION_MINUTES = 45;

export type GuestStatus = 'invited' | 'booked' | 'cancelled';

/** The status is read from the row, not stored (0005). */
export function invitationStatus(row: Pick<QurooshGuestInvitation, 'slot_id' | 'cancelled_at'>): GuestStatus {
  if (row.cancelled_at) return 'cancelled';
  if (row.slot_id) return 'booked';
  return 'invited';
}

/** A slot and the guest holding it, if any. */
export type GuestSlotRow = QurooshGuestSlot & {
  guest: { id: string; name: string } | null;
  /** Already started: no longer offered to guests. */
  past: boolean;
};

/**
 * A project's slots, oldest first, each with the guest who booked it. `ready`
 * is false before Quroosh 0005 is applied (the table is missing), so the page
 * can say so instead of failing.
 */
export async function loadSlots(
  db: SupabaseClient,
  projectId: string,
): Promise<{ ready: boolean; slots: GuestSlotRow[] }> {
  const [slotsResult, bookedResult] = await Promise.all([
    db
      .from('guest_slots')
      .select('id, project_id, starts_at, active, created_at, updated_at, updated_by')
      .eq('project_id', projectId)
      .order('starts_at'),
    db
      .from('guest_invitations')
      .select('id, name, slot_id')
      .eq('project_id', projectId)
      .not('slot_id', 'is', null),
  ]);
  if (slotsResult.error || bookedResult.error) return { ready: false, slots: [] };

  const guestBySlot = new Map(
    ((bookedResult.data ?? []) as { id: string; name: string; slot_id: string }[]).map((g) => [
      g.slot_id,
      { id: g.id, name: g.name },
    ]),
  );
  const now = Date.now();
  const slots = ((slotsResult.data ?? []) as QurooshGuestSlot[]).map((slot) => ({
    ...slot,
    guest: guestBySlot.get(slot.id) ?? null,
    past: new Date(slot.starts_at).getTime() <= now,
  }));
  return { ready: true, slots };
}

/** When a session that starts at `startsAt` ends. */
export function slotEnd(startsAt: string | Date): Date {
  return new Date(new Date(startsAt).getTime() + GUEST_SESSION_MINUTES * 60_000);
}

/** Slots grouped by their day on the club's clock (`YYYY-MM-DD`), in order. */
export function groupSlotsByDay<T extends { starts_at: string }>(slots: T[]): { day: string; slots: T[] }[] {
  const days = new Map<string, T[]>();
  for (const slot of slots) {
    const day = toDateInput(new Date(slot.starts_at));
    const list = days.get(day) ?? [];
    list.push(slot);
    days.set(day, list);
  }
  return [...days.entries()].map(([day, list]) => ({ day, slots: list }));
}

/**
 * A club-clock day (`YYYY-MM-DD`) as a heading: "Saturday 21 November 2026".
 * Read at noon UTC, which is the same day in Riyadh, so no clock can move it.
 */
export function formatSlotDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', {
    timeZone: CLUB_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${day}T12:00:00Z`));
}
