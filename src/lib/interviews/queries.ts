import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDaysToDateInput, clubTimestamp } from '@/lib/time';
import { normalisePhone } from '@/lib/interviews/phone';
import { pages } from '@/lib/interviews/sheetFormat';
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

export type AcceptedPhone = { application_id: string; phone: string; name: string; decided_at: string | null };

export type PhoneMatch = { id: string; phone: string | null; email: string | null; submitted_at: string };

/**
 * Every application of the edition by its normalised phone number
 * (phone.ts), so "+966 50…" and "050…" find the same person. Where several
 * share a number, the one with an email wins, then the newest. Used by HR's
 * accepted list and the candidate link, which both match on phone alone.
 */
export async function applicationsByPhone(db: SupabaseClient, editionId: string): Promise<Map<string, PhoneMatch>> {
  const byPhone = new Map<string, PhoneMatch>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from('applications')
      .select('id, phone, email, submitted_at')
      .eq('edition_id', editionId)
      .not('phone', 'is', null)
      .order('id')
      .range(from, from + 999);
    const rows = (data ?? []) as PhoneMatch[];
    for (const row of rows) {
      const key = normalisePhone(row.phone);
      if (!key) continue;
      const held = byPhone.get(key);
      const better =
        !held ||
        (row.email !== null && held.email === null) ||
        ((row.email !== null) === (held.email !== null) && row.submitted_at > held.submitted_at);
      if (better) byPhone.set(key, row);
    }
    if (rows.length < 1000) break;
  }
  return byPhone;
}

/**
 * Who is on each assignment's accepted list (0014's session_acceptances),
 * by session id, newest first. `ready` is false until 0014 is applied, so
 * the Rooms tab can say so instead of showing empty lists.
 */
export async function loadSessionAcceptances(
  db: SupabaseClient,
  editionId: string,
): Promise<{ ready: boolean; bySession: Map<string, AcceptedPhone[]> }> {
  const bySession = new Map<string, AcceptedPhone[]>();
  type Row = {
    session_id: string;
    application_id: string;
    accepted_at: string;
    applications: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null;
  };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('session_acceptances')
      .select('session_id, application_id, accepted_at, applications(name, phone)')
      .eq('edition_id', editionId)
      .is('revoked_at', null)
      .order('accepted_at', { ascending: false })
      .range(from, from + 999);
    if (error) return { ready: false, bySession };
    for (const row of (data ?? []) as Row[]) {
      const app = Array.isArray(row.applications) ? row.applications[0] : row.applications;
      const list = bySession.get(row.session_id) ?? [];
      list.push({ application_id: row.application_id, phone: app?.phone ?? '', name: app?.name ?? '', decided_at: row.accepted_at });
      bySession.set(row.session_id, list);
    }
    if ((data ?? []).length < 1000) break;
  }
  return { ready: true, bySession };
}

/** The assignments a student is on the accepted list of (none before 0014). */
export async function loadSessionsAcceptedFor(db: SupabaseClient, applicationId: string): Promise<Set<string>> {
  const { data, error } = await db
    .from('session_acceptances')
    .select('session_id')
    .eq('application_id', applicationId)
    .is('revoked_at', null);
  return new Set(error ? [] : (data ?? []).map((r) => r.session_id as string));
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

/** How many rows HR's list shows; `total` says how many matched. */
export const APPLICANTS_SHOWN = 500;

/**
 * The applicant pool with every preference, for HR's list. The search box
 * narrows in the database; the company and decision filters narrow by what
 * the student asked for. The list shows the newest APPLICANTS_SHOWN matches
 * and `total` counts them all.
 *
 * Everything is read in pages (an edition passes PostgREST's 1000 rows), and
 * the preferences by edition rather than by a list of ids. The old version
 * filtered the newest 500 only, so the 8 AM wave fell outside every company
 * filter once more arrived, and it sent their ids in the URL: with a few
 * hundred applicants the request was too long, the error was dropped, and
 * every Choices badge and filter came back empty.
 */
export async function loadApplicants(
  db: SupabaseClient,
  editionId: string,
  filters: ApplicantFilters,
): Promise<{ applications: Application[]; preferences: Preference[]; total: number }> {
  const q = filters.q?.trim();
  const term = q ? q.replace(/[%,()]/g, ' ') : null;

  const [rows, allPrefs] = await Promise.all([
    pages<Application>((from, to) => {
      let query = db
        .from('applications')
        .select('*')
        .eq('edition_id', editionId)
        .order('submitted_at', { ascending: false })
        .order('id')
        .range(from, to);
      if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
      return query;
    }),
    pages<Preference>((from, to) =>
      db
        .from('application_preferences')
        .select('*')
        .eq('edition_id', editionId)
        .order('application_id')
        .order('rank')
        .range(from, to),
    ),
  ]);
  if (rows.length === 0) return { applications: [], preferences: [], total: 0 };

  let apps = rows;
  // Company and decision filters narrow by what the student asked for.
  if (filters.companyId || filters.decision) {
    const keep = new Set(
      allPrefs
        .filter(
          (p) =>
            (!filters.companyId || p.company_id === filters.companyId) &&
            (!filters.decision || p.decision === filters.decision),
        )
        .map((p) => p.application_id),
    );
    apps = apps.filter((a) => keep.has(a.id));
  }

  const shown = apps.slice(0, APPLICANTS_SHOWN);
  const ids = new Set(shown.map((a) => a.id));
  return {
    applications: shown,
    preferences: allPrefs.filter((p) => ids.has(p.application_id)),
    total: apps.length,
  };
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
 * day goes on. The caller marks a slot "taken" for display when it is
 * booked or closed; a past one is shown open, and book_slot decides
 * (0009): refused once the edition is active, allowed while it is a draft
 * being tried out against today's date.
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
