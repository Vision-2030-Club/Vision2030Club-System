import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { siteUrl } from '@/lib/site';
import { CLUB_TIME_ZONE } from '@/lib/time';
import type { QurooshGuestInvitation, QurooshGuestSlot } from './types';

/**
 * Guest invitations and their bookings (Quroosh 0005): the project's managers
 * offer days (slots), invite guests, and each guest books one day on their
 * own link. One guest per day; the database makes that so.
 *
 * A slot is a day: saved as that day at 00:00 Riyadh time (`starts_at`), and
 * shown as the day only (slotDay), never a time, on the club's clock whatever
 * the viewer's time zone: guests may open their link from abroad. Because
 * the database offers a slot while `starts_at` is still ahead, a day is
 * offered until the day before, and not on the day itself.
 */

export type GuestStatus = 'invited' | 'booked' | 'cancelled';

/** The badge colour of each status, the same on every page. */
export const GUEST_STATUS_TONE: Record<GuestStatus, 'brand' | 'ok' | 'neutral'> = {
  invited: 'brand',
  booked: 'ok',
  cancelled: 'neutral',
};

/** The status is read from the row, not stored (0005). */
export function invitationStatus(row: Pick<QurooshGuestInvitation, 'slot_id' | 'cancelled_at'>): GuestStatus {
  if (row.cancelled_at) return 'cancelled';
  if (row.slot_id) return 'booked';
  return 'invited';
}

/**
 * A guest's personal link: the public booking page (/quroosh/invite/<token>),
 * in the manager's language; the page has a language switch. Anyone holding
 * it can open it, so it is shown to managers to copy, never linked.
 */
export function invitationUrl(locale: string, token: string): string {
  return `${siteUrl()}/${locale}/quroosh/invite/${token}`;
}

/** An invitation with the start of the slot it holds (null when not booked). */
export type GuestWithSlot<T> = T & { slot_starts_at: string | null };

/** The embedded slot (`guest_slots(starts_at)`, through slot_id) flattened. */
function withSlot<T extends Record<string, unknown>>(row: T): GuestWithSlot<Omit<T, 'guest_slots'>> {
  const { guest_slots: slot, ...rest } = row as T & { guest_slots?: { starts_at: string } | null };
  return { ...rest, slot_starts_at: slot?.starts_at ?? null };
}

/** What the guests list shows of an invitation: no token, no note. */
export type GuestListRow = GuestWithSlot<
  Pick<
    QurooshGuestInvitation,
    'id' | 'name' | 'role' | 'slot_id' | 'phone' | 'needs_transport' | 'cancelled_at' | 'created_at'
  >
>;

/**
 * A project's invited guests, newest first, each with their booked slot's
 * start. `ready` is false before Quroosh 0005 is applied.
 */
export async function loadInvitations(
  db: SupabaseClient,
  projectId: string,
): Promise<{ ready: boolean; invitations: GuestListRow[] }> {
  const { data, error } = await db
    .from('guest_invitations')
    .select('id, name, role, slot_id, phone, needs_transport, cancelled_at, created_at, guest_slots(starts_at)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) return { ready: false, invitations: [] };
  return { ready: true, invitations: ((data ?? []) as Record<string, unknown>[]).map(withSlot) as GuestListRow[] };
}

/**
 * One invitation of the project with its booked slot's start, or null when
 * there is none by that id in this project. `ready` is false before Quroosh
 * 0005 is applied.
 */
export async function loadInvitation(
  db: SupabaseClient,
  projectId: string,
  invitationId: string,
): Promise<{ ready: boolean; invitation: GuestWithSlot<QurooshGuestInvitation> | null }> {
  const { data, error } = await db
    .from('guest_invitations')
    .select('*, guest_slots(starts_at)')
    .eq('project_id', projectId)
    .eq('id', invitationId)
    .maybeSingle();
  if (error) return { ready: false, invitation: null };
  return {
    ready: true,
    invitation: data ? (withSlot(data as Record<string, unknown>) as GuestWithSlot<QurooshGuestInvitation>) : null,
  };
}

/** A slot and the guest holding it, if any. */
export type GuestSlotRow = QurooshGuestSlot & {
  guest: { id: string; name: string } | null;
  /** Its day has begun (00:00 Riyadh): no longer offered to guests. */
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

/**
 * A slot as everyone reads it: its day only, never a time. Slots are days
 * (the managers add a date; the app saves it as 00:00 Riyadh time through
 * save_slot), so the time is always midnight and means nothing to anyone.
 * Written as on the printed invitation cards: the full day name and date,
 * no year, Latin digits ("الأحد 22 نوفمبر", "Sunday 22 November"), on the
 * club's clock whatever the viewer's own time zone.
 */
export function slotDay(startsAt: string, locale: string): string {
  // Built from its parts: Arabic's own format puts a comma after the day name.
  const parts = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', {
    timeZone: CLUB_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(new Date(startsAt));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

/**
 * The span of days on offer, as the invitation's info row writes it, like
 * the printed cards: "21–26 نوفمبر", "21 November – 2 December", or one day
 * alone. Latin digits, on the club's clock.
 */
export function slotDayRange(first: string, last: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', {
    timeZone: CLUB_TIME_ZONE,
    day: 'numeric',
    month: 'long',
  }).formatRange(new Date(first), new Date(last));
}
