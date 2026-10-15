import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { siteUrl } from './email';
import { loadCompanies, loadRooms } from './queries';
import type { Decision, Edition, Stage, WalkinRequest } from './types';

/**
 * Walk-ins (0016): a student who turns up without an interview registers on
 * the walk-in link for one company with a free time later today, and the
 * reception desk confirms them into one of those times.
 *
 * The link's token, whether walk-ins are open, and the companies that take
 * none are edition settings (`walkin_token`, `walkins_open`,
 * `walkins_off_companies`), changed on the Settings tab. Which times are
 * free is the database's to say (`walkin_slots`); nothing here decides it.
 */
export type WalkinSettings = { open: boolean; token: string | null; offCompanies: string[] };

export function walkinSettings(
  settings: { walkins_open?: unknown; walkin_token?: unknown; walkins_off_companies?: unknown } | null | undefined,
): WalkinSettings {
  const token = typeof settings?.walkin_token === 'string' && settings.walkin_token ? settings.walkin_token : null;
  const off = Array.isArray(settings?.walkins_off_companies)
    ? settings.walkins_off_companies.filter((id): id is string => typeof id === 'string')
    : [];
  return { open: settings?.walkins_open === true, token, offCompanies: off };
}

/** Today on the edition's clock, as `YYYY-MM-DD`: the day walk-ins are given times on. */
export function editionToday(edition: Pick<Edition, 'time_zone'>): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: edition.time_zone || 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** The address the QR code at the venue points to. */
export function walkinUrl(locale: string, token: string): string {
  return `${siteUrl()}/${locale}/interviews/w/${token}`;
}

/** The edition a walk-in link belongs to, if any. */
export async function editionByWalkinToken(db: SupabaseClient, token: string): Promise<Edition | null> {
  const { data } = await db.from('editions').select('*').eq('settings->>walkin_token', token).limit(1).maybeSingle();
  return (data as Edition | null) ?? null;
}

export type WalkinSlot = { slot_id: string; company_id: string; room_id: string; starts_at: string; ends_at: string };

/** The free times a walk-in can be given now, or null before 0016 is applied. */
export async function loadWalkinSlots(db: SupabaseClient, editionId: string): Promise<WalkinSlot[] | null> {
  const { data, error } = await db.rpc('walkin_slots', { p_edition: editionId });
  if (error) return null;
  return (data ?? []) as WalkinSlot[];
}

type Named = { company_name_en: string; company_name_ar: string };

export type QueueItem = Named & {
  id: string;
  seq: number;
  status: 'pending' | 'confirmed' | 'rejected';
  name: string;
  email: string;
  phone: string | null;
  company_id: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  /** The interview a confirmed request became. */
  booking: { starts_at: string; room_name: string; stage: Stage } | null;
  /** What the student already has, by the same email: online choices and HR's decisions, and live interviews. */
  history: {
    decisions: (Named & { decision: Decision })[];
    interviews: (Named & { starts_at: string; stage: Stage })[];
  } | null;
};

export type WalkinQueue = {
  /** False until 0016 is applied. */
  ready: boolean;
  pending: QueueItem[];
  /** Today's confirmed and rejected requests, newest first. */
  decided: QueueItem[];
  /** Free times by company, for the confirm picker. */
  times: Record<string, { slot_id: string; starts_at: string; room_name: string }[]>;
};

type RequestRow = Pick<
  WalkinRequest,
  'id' | 'seq' | 'status' | 'name' | 'email' | 'phone' | 'company_id' | 'created_at' | 'decided_at' | 'decided_by' | 'decision_note' | 'booking_id'
>;

/**
 * Everything the reception desk's walk-in queue shows: every waiting request,
 * today's decided ones, what each student already has, and the free times.
 * A handful of small queries; polled every ten seconds.
 */
export async function loadWalkinQueue(db: SupabaseClient, editionId: string, today: string): Promise<WalkinQueue> {
  const empty: WalkinQueue = { ready: false, pending: [], decided: [], times: {} };
  const { data: rows, error } = await db
    .from('walkin_requests')
    .select('id, seq, status, name, email, phone, company_id, created_at, decided_at, decided_by, decision_note, booking_id')
    .eq('edition_id', editionId)
    .or(`status.eq.pending,day.eq.${today}`)
    .order('created_at');
  if (error) return empty;
  const requests = (rows ?? []) as RequestRow[];

  const [companies, rooms, slots] = await Promise.all([
    loadCompanies(db, editionId),
    loadRooms(db, editionId),
    loadWalkinSlots(db, editionId),
  ]);
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const named = (companyId: string): Named => ({
    company_name_en: companyById.get(companyId)?.name_en ?? '',
    company_name_ar: companyById.get(companyId)?.name_ar ?? '',
  });

  // What each waiting student already has, matched by email.
  const pendingEmails = [...new Set(requests.filter((r) => r.status === 'pending').map((r) => r.email))];
  const appByEmail = new Map<string, string>();
  const decisionsByApp = new Map<string, (Named & { decision: Decision })[]>();
  const interviewsByApp = new Map<string, (Named & { starts_at: string; stage: Stage })[]>();
  if (pendingEmails.length) {
    const { data: apps } = await db
      .from('applications')
      .select('id, email')
      .eq('edition_id', editionId)
      .in('email', pendingEmails);
    for (const a of (apps ?? []) as { id: string; email: string }[]) appByEmail.set(a.email.toLowerCase(), a.id);
    const appIds = [...appByEmail.values()];
    if (appIds.length) {
      const [{ data: prefs }, { data: bookings }] = await Promise.all([
        db.from('application_preferences').select('application_id, company_id, decision, rank').in('application_id', appIds).order('rank'),
        db
          .from('bookings')
          .select('application_id, company_id, starts_at, stage')
          .in('application_id', appIds)
          .is('cancelled_at', null)
          .order('starts_at'),
      ]);
      for (const p of (prefs ?? []) as { application_id: string; company_id: string; decision: Decision }[]) {
        const list = decisionsByApp.get(p.application_id) ?? [];
        list.push({ ...named(p.company_id), decision: p.decision });
        decisionsByApp.set(p.application_id, list);
      }
      for (const b of (bookings ?? []) as { application_id: string; company_id: string; starts_at: string; stage: Stage }[]) {
        const list = interviewsByApp.get(b.application_id) ?? [];
        list.push({ ...named(b.company_id), starts_at: b.starts_at, stage: b.stage });
        interviewsByApp.set(b.application_id, list);
      }
    }
  }

  // The interviews confirmed requests became.
  const bookingIds = requests.map((r) => r.booking_id).filter((id): id is string => Boolean(id));
  const bookingById = new Map<string, QueueItem['booking']>();
  if (bookingIds.length) {
    const { data: bookings } = await db.from('bookings').select('id, starts_at, stage, slots(room_id)').in('id', bookingIds);
    for (const b of (bookings ?? []) as unknown as { id: string; starts_at: string; stage: Stage; slots: { room_id: string } | null }[]) {
      bookingById.set(b.id, { starts_at: b.starts_at, stage: b.stage, room_name: roomName.get(b.slots?.room_id ?? '') ?? '' });
    }
  }

  const items = requests.map((r): QueueItem => {
    const appId = r.status === 'pending' ? appByEmail.get(r.email.toLowerCase()) : undefined;
    return {
      id: r.id,
      seq: r.seq,
      status: r.status,
      name: r.name,
      email: r.email,
      phone: r.phone,
      company_id: r.company_id,
      ...named(r.company_id),
      created_at: r.created_at,
      decided_at: r.decided_at,
      decided_by: r.decided_by,
      decision_note: r.decision_note,
      booking: r.booking_id ? (bookingById.get(r.booking_id) ?? null) : null,
      history: appId ? { decisions: decisionsByApp.get(appId) ?? [], interviews: interviewsByApp.get(appId) ?? [] } : null,
    };
  });

  const times: WalkinQueue['times'] = {};
  for (const s of slots ?? []) {
    (times[s.company_id] ??= []).push({ slot_id: s.slot_id, starts_at: s.starts_at, room_name: roomName.get(s.room_id) ?? '' });
  }

  return {
    ready: true,
    pending: items.filter((i) => i.status === 'pending'),
    decided: items
      .filter((i) => i.status !== 'pending')
      .sort((a, b) => (b.decided_at ?? '').localeCompare(a.decided_at ?? '')),
    times,
  };
}
