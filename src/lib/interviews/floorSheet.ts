import 'server-only';
import { after } from 'next/server';
import { GoogleNotConnectedError, isGoogleConfigured } from '@/lib/google/auth';
import { createFloorSheet, writeFloorSheet } from '@/lib/google/sheets';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { signCvLong } from '@/lib/interviews/cv';
import type { Edition, SlotStatus } from '@/lib/interviews/types';
import { loadRooms } from '@/lib/interviews/queries';

/**
 * A one-way mirror: this database → the sheet, never the other way.
 *
 * A cell a person edited by hand would be silently overwritten by the next
 * sync anyway (writeFloorSheet always rewrites the whole thing), and reading
 * the sheet back in would mean trusting arbitrary text as a booking change —
 * bypassing every constraint that keeps two people out of one slot. Read-only
 * is not a missing feature here; it is what makes the mirror safe.
 *
 * Laid out as one block per room rather than one flat table: a room's own
 * header row, a column header row (Name, Time, Phone, CV), its bookings in
 * time order, then a blank row before the next room. companyName is loaded
 * only to resolve a slot's room — the block itself never names the company,
 * since here a room and its company are the same booth (0005).
 */

const COLUMNS = ['Name', 'Time', 'Phone', 'CV'];

function fmtSlotTime(startsAt: string, endsAt: string, zone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: '2-digit', month: 'short' }).format(
    new Date(startsAt),
  );
  const start = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(startsAt),
  );
  const end = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(endsAt),
  );
  return `${day} · ${start}–${end}`;
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

  const [rooms, { data: slotRows }] = await Promise.all([
    loadRooms(db, editionId),
    db
      .from('slot_status')
      .select('*')
      .eq('edition_id', editionId)
      .not('booking_id', 'is', null)
      .order('starts_at'),
  ]);
  const slots = (slotRows ?? []) as SlotStatus[];

  const applicationIds = [...new Set(slots.map((s) => s.application_id).filter((v): v is string => Boolean(v)))];
  const { data: applicationRows } = applicationIds.length
    ? await db.from('applications').select('id, cv_path').in('id', applicationIds)
    : { data: [] };
  const cvPathByApplication = new Map(
    ((applicationRows ?? []) as { id: string; cv_path: string | null }[]).map((a) => [a.id, a.cv_path]),
  );

  const zone = edition.time_zone;
  const roomsSorted = [...rooms].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const values: string[][] = [];
  const boldRows: number[] = [];

  for (const room of roomsSorted) {
    const roomSlots = slots
      .filter((s) => s.room_id === room.id)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    if (roomSlots.length === 0) continue;

    boldRows.push(values.length);
    values.push([room.name, '', '', '']);
    boldRows.push(values.length);
    values.push(COLUMNS);

    for (const slot of roomSlots) {
      const cvPath = slot.application_id ? cvPathByApplication.get(slot.application_id) : null;
      const cvUrl = cvPath ? await signCvLong(db, cvPath) : null;
      values.push([
        slot.student_name ?? '',
        fmtSlotTime(slot.starts_at, slot.ends_at, zone),
        slot.student_phone ?? '',
        cvUrl ? `=HYPERLINK("${cvUrl}", "View CV")` : '',
      ]);
    }

    values.push(['', '', '', '']);
  }

  const spreadsheetId = await ensureFloorSheet(db, edition);
  await writeFloorSheet(spreadsheetId, values, boldRows);
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
