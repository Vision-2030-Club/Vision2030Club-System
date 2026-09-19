import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDaysToDateInput, clubTimestamp } from '@/lib/time';
import type { BoardBooking } from '@/lib/interviews/board';
import type {
  Application,
  Booking,
  Company,
  Feedback,
  FloorRow,
  Preference,
  Room,
  Session,
  SlotStatus,
} from '@/lib/interviews/types';

/**
 * Reads against the interviews database. Every function takes the service
 * client and an edition id — the caller has already been through
 * `getInterviewAccess`, or resolved a public token — and returns plain rows.
 * Writes never happen here; they are Postgres functions (see the migrations)
 * called from the server actions.
 */

/** The bounds of one calendar day on the edition's clock, as Postgres literals. */
export function dayBounds(day: string, zone: string): { from: string; to: string } {
  return {
    from: clubTimestamp(day, '00:00', zone),
    to: clubTimestamp(addDaysToDateInput(day, 1), '00:00', zone),
  };
}

export async function loadRooms(db: SupabaseClient, editionId: string): Promise<Room[]> {
  const { data } = await db
    .from('rooms')
    .select('*')
    .eq('edition_id', editionId)
    .order('sort_order')
    .order('name');
  return (data ?? []) as Room[];
}

export async function loadCompanies(db: SupabaseClient, editionId: string): Promise<Company[]> {
  const { data } = await db
    .from('companies')
    .select('*')
    .eq('edition_id', editionId)
    .order('sort_order')
    .order('name_en');
  return (data ?? []) as Company[];
}

export async function loadSessions(
  db: SupabaseClient,
  editionId: string,
  day?: string,
): Promise<Session[]> {
  let query = db.from('sessions').select('*').eq('edition_id', editionId).order('starts_at');
  if (day) query = query.eq('day', day);
  const { data } = await query;
  return (data ?? []) as Session[];
}

/** The distinct days an edition has sessions on, earliest first. */
export function sessionDays(sessions: { day: string }[]): string[] {
  return [...new Set(sessions.map((s) => s.day))].sort();
}

/** One slot of one day, with its holder and the names a board needs. */
export type DayRow = SlotStatus & {
  company_name_en: string;
  company_name_ar: string;
  room_name: string;
};

/**
 * Every slot of a day (optionally one company's), with whoever holds it.
 * Read by the floor board, the interviewer page, the TV and the schedule —
 * all of which poll, so this is one indexed query plus two small lookups.
 */
export async function loadDayRows(
  db: SupabaseClient,
  editionId: string,
  day: string,
  zone: string,
  companyId?: string,
): Promise<DayRow[]> {
  const { from, to } = dayBounds(day, zone);
  let query = db
    .from('slot_status')
    .select('*')
    .eq('edition_id', editionId)
    .gte('starts_at', from)
    .lt('starts_at', to)
    .order('starts_at');
  if (companyId) query = query.eq('company_id', companyId);

  const [{ data: rows }, companies, rooms] = await Promise.all([
    query,
    loadCompanies(db, editionId),
    loadRooms(db, editionId),
  ]);

  const companyById = new Map(companies.map((c) => [c.id, c]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  return ((rows ?? []) as SlotStatus[]).map((row) => ({
    ...row,
    company_name_en: companyById.get(row.company_id)?.name_en ?? '',
    company_name_ar: companyById.get(row.company_id)?.name_ar ?? '',
    room_name: roomById.get(row.room_id)?.name ?? '',
  }));
}

export type CompanyCounter = {
  company_id: string;
  accepted: number;
  rejected: number;
  pending: number;
  slots_total: number;
  slots_booked: number;
};

export async function loadCounters(
  db: SupabaseClient,
  editionId: string,
): Promise<Map<string, CompanyCounter>> {
  const { data } = await db.from('company_counters').select('*').eq('edition_id', editionId);
  return new Map(((data ?? []) as CompanyCounter[]).map((row) => [row.company_id, row]));
}

export type AcceptedPhone = { phone: string; name: string; decided_at: string | null };

/** HR's pre-approval list (0005) for one company/room's candidate link. */
export async function loadAcceptedPhones(
  db: SupabaseClient,
  companyId: string,
): Promise<AcceptedPhone[]> {
  const { data } = await db.rpc('accepted_phones', { p_company: companyId });
  return (data ?? []) as AcceptedPhone[];
}

export async function countApplications(db: SupabaseClient, editionId: string): Promise<number> {
  const { count } = await db
    .from('applications')
    .select('id', { count: 'exact', head: true })
    .eq('edition_id', editionId);
  return count ?? 0;
}

export async function countActiveBookings(db: SupabaseClient, editionId: string): Promise<number> {
  const { count } = await db
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('edition_id', editionId)
    .is('cancelled_at', null);
  return count ?? 0;
}

export type ApplicantFilters = {
  q?: string;
  companyId?: string;
  decision?: string;
};

/**
 * The applicant pool with every preference, for HR's list. Capped at 500
 * rows; the search box is how a bigger pool is narrowed, not paging.
 */
export async function loadApplicants(
  db: SupabaseClient,
  editionId: string,
  filters: ApplicantFilters,
): Promise<{ applications: Application[]; preferences: Preference[] }> {
  let query = db
    .from('applications')
    .select('*')
    .eq('edition_id', editionId)
    .order('submitted_at', { ascending: false })
    .limit(500);

  const q = filters.q?.trim();
  if (q) {
    const term = q.replace(/[%,]/g, ' ');
    query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const { data: applications } = await query;
  const rows = (applications ?? []) as Application[];
  if (rows.length === 0) return { applications: [], preferences: [] };

  const { data: preferences } = await db
    .from('application_preferences')
    .select('*')
    .in(
      'application_id',
      rows.map((a) => a.id),
    )
    .order('rank');

  let prefs = (preferences ?? []) as Preference[];
  let apps = rows;

  // Company and decision filters narrow by what the student asked for.
  if (filters.companyId || filters.decision) {
    const keep = new Set(
      prefs
        .filter(
          (p) =>
            (!filters.companyId || p.company_id === filters.companyId) &&
            (!filters.decision || p.decision === filters.decision),
        )
        .map((p) => p.application_id),
    );
    apps = apps.filter((a) => keep.has(a.id));
    prefs = prefs.filter((p) => keep.has(p.application_id));
  }

  return { applications: apps, preferences: prefs };
}

export async function loadApplication(
  db: SupabaseClient,
  applicationId: string,
): Promise<Application | null> {
  const { data } = await db.from('applications').select('*').eq('id', applicationId).maybeSingle();
  return (data as Application | null) ?? null;
}

export async function loadPreferences(
  db: SupabaseClient,
  applicationId: string,
): Promise<Preference[]> {
  const { data } = await db
    .from('application_preferences')
    .select('*')
    .eq('application_id', applicationId)
    .order('rank');
  return (data ?? []) as Preference[];
}

/** A student's bookings, active first, cancelled ones after. */
export async function loadBookingsOf(
  db: SupabaseClient,
  applicationId: string,
): Promise<Booking[]> {
  const { data } = await db
    .from('bookings')
    .select('*')
    .eq('application_id', applicationId)
    .order('starts_at');
  return (data ?? []) as Booking[];
}

export async function loadFeedbackFor(
  db: SupabaseClient,
  bookingIds: string[],
): Promise<Map<string, Feedback>> {
  if (bookingIds.length === 0) return new Map();
  const { data } = await db.from('feedback').select('*').in('booking_id', bookingIds);
  return new Map(((data ?? []) as Feedback[]).map((f) => [f.booking_id, f]));
}

/**
 * Free, future, open slots of one company — what a student picks from.
 * Grouped by day (on the edition's clock) by the caller.
 */
export async function loadFreeSlots(
  db: SupabaseClient,
  companyId: string,
): Promise<SlotStatus[]> {
  const { data } = await db
    .from('slot_status')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_closed', false)
    .is('booking_id', null)
    .gt('starts_at', new Date().toISOString())
    .order('starts_at');
  return (data ?? []) as SlotStatus[];
}

/**
 * Every slot of one company, free, already held, or already past — what the
 * room picker (0005) shows, so a candidate always sees the room's whole
 * scheduled range (e.g. 2-8) rather than it shrinking from the start as the
 * day goes on. The caller marks a slot "taken" for display the same way
 * whether it is booked or simply in the past; book_slot still refuses a
 * past one server-side regardless of what the client shows.
 */
export async function loadAllSlots(
  db: SupabaseClient,
  companyId: string,
): Promise<SlotStatus[]> {
  const { data } = await db
    .from('slot_status')
    .select('*')
    .eq('company_id', companyId)
    .order('starts_at');
  return (data ?? []) as SlotStatus[];
}

/** The board shape every polling route returns. */
export function toFloorRow(row: DayRow): FloorRow {
  return {
    slot_id: row.id,
    booking_id: row.booking_id,
    application_id: row.application_id,
    company_id: row.company_id,
    company_name_en: row.company_name_en,
    company_name_ar: row.company_name_ar,
    room_name: row.room_name,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    is_closed: row.is_closed,
    student_name: row.student_name,
    student_phone: row.student_phone,
    stage: row.stage,
    arrived_at: row.arrived_at,
    stage_changed_at: row.stage_changed_at,
  };
}

/** What the TV needs from a day: only the held slots, with the names on them. */
export function toBoardBookings(rows: DayRow[]): BoardBooking[] {
  return rows
    .filter((r): r is DayRow & { booking_id: string; stage: NonNullable<DayRow['stage']> } =>
      Boolean(r.booking_id && r.stage),
    )
    .map((r) => ({
      booking_id: r.booking_id,
      student_name: r.student_name ?? '',
      company_name_en: r.company_name_en,
      company_name_ar: r.company_name_ar,
      room_name: r.room_name,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      stage: r.stage,
      arrived_at: r.arrived_at,
      stage_changed_at: r.stage_changed_at,
    }));
}
