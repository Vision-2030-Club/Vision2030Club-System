import 'server-only';
import { after } from 'next/server';
import { GoogleNotConnectedError, isGoogleConfigured } from '@/lib/google/auth';
import { createFloorSheet, writeFloorSheet } from '@/lib/google/sheets';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import type { Edition, SlotStatus } from '@/lib/interviews/types';
import { loadCompanies, loadRooms } from '@/lib/interviews/queries';

/**
 * A one-way mirror: this database → the sheet, never the other way.
 *
 * A cell a person edited by hand would be silently overwritten by the next
 * sync anyway (writeFloorSheet always rewrites the whole thing), and reading
 * the sheet back in would mean trusting arbitrary text as a booking change —
 * bypassing every constraint that keeps two people out of one slot. Read-only
 * is not a missing feature here; it is what makes the mirror safe.
 */

const HEADER = ['Day', 'Room', 'Company', 'Time', 'Candidate', 'Phone', 'Stage', 'Updated'];

function fmtDate(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );
}

function fmtTime(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(iso),
  );
}

async function ensureFloorSheet(
  db: ReturnType<typeof createInterviewsClient>,
  edition: Edition,
): Promise<string> {
  if (edition.floor_sheet_id) return edition.floor_sheet_id;

  const created = await createFloorSheet(`${edition.name_en} — Floor`);
  await db.rpc('set_floor_sheet', {
    p_edition: edition.id,
    p_sheet_id: created.id,
    p_sheet_url: created.url,
  });
  return created.id;
}

/** Rebuilds one edition's floor sheet from scratch. Call via kickFloorSheetSync. */
export async function syncFloorSheet(editionId: string): Promise<void> {
  if (!isGoogleConfigured()) return;

  const db = createInterviewsClient();
  const { data: editionRow } = await db.from('editions').select('*').eq('id', editionId).maybeSingle();
  const edition = editionRow as Edition | null;
  if (!edition) return;

  const [companies, rooms, { data: slotRows }] = await Promise.all([
    loadCompanies(db, editionId),
    loadRooms(db, editionId),
    db
      .from('slot_status')
      .select('*')
      .eq('edition_id', editionId)
      .not('booking_id', 'is', null)
      .order('starts_at'),
  ]);
  const slots = (slotRows ?? []) as SlotStatus[];

  const companyName = new Map(companies.map((c) => [c.id, c.name_en]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const zone = edition.time_zone;

  const rows = slots.map((s) => [
    fmtDate(s.starts_at, zone),
    roomName.get(s.room_id) ?? '',
    companyName.get(s.company_id) ?? '',
    `${fmtTime(s.starts_at, zone)}–${fmtTime(s.ends_at, zone)}`,
    s.student_name ?? '',
    s.student_phone ?? '',
    s.stage ?? '',
    s.stage_changed_at ? fmtTime(s.stage_changed_at, zone) : '',
  ]);

  const spreadsheetId = await ensureFloorSheet(db, edition);
  await writeFloorSheet(spreadsheetId, [HEADER, ...rows]);
}

/**
 * Fire-and-forget, after the response has gone out — same pattern as
 * kickEmailDelivery. A Google hiccup (not connected yet, a revoked token,
 * a rate limit) must never fail the booking action that triggered it; it is
 * logged and the next change tries again.
 */
export function kickFloorSheetSync(editionId: string): void {
  after(async () => {
    try {
      await syncFloorSheet(editionId);
    } catch (error) {
      if (error instanceof GoogleNotConnectedError) return;
      console.error('[interviews/floorSheet] sync failed', error);
    }
  });
}
