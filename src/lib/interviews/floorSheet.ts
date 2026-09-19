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
 * Laid out two rooms per row, each its own block: a merged, centred, navy
 * title bar naming the room, a navy Name/Time/Phone/CV header row, that
 * room's bookings in time order, then blanks padding it level with its
 * neighbour. A room never names its own company — here a room and its
 * company are the same booth (0005) — and a blank spacer row separates
 * each pair of rooms from the next.
 */

const COLUMNS = ['Name', 'Time', 'Phone', 'CV'];
const BLOCK_COLS = COLUMNS.length;
const PAIR_COLS = BLOCK_COLS * 2 + 1; // two blocks + one gap column between them

const NAVY = { red: 0.11, green: 0.23, blue: 0.39 };
const WHITE = { red: 1, green: 1, blue: 1 };

function blankRow(): string[] {
  return Array(BLOCK_COLS).fill('');
}

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

type RoomForSheet = { id: string; name: string };

/** Title row, header row, then one row per booking — always BLOCK_COLS wide. */
async function buildRoomBlock(
  db: ReturnType<typeof createInterviewsClient>,
  room: RoomForSheet,
  slots: SlotStatus[],
  cvPathByApplication: Map<string, string | null>,
  zone: string,
): Promise<string[][]> {
  const rows: string[][] = [[room.name, '', '', ''], [...COLUMNS]];

  for (const slot of slots) {
    const cvPath = slot.application_id ? cvPathByApplication.get(slot.application_id) : null;
    const cvUrl = cvPath ? await signCvLong(db, cvPath) : null;
    rows.push([
      slot.student_name ?? '',
      fmtSlotTime(slot.starts_at, slot.ends_at, zone),
      slot.student_phone ?? '',
      cvUrl ? `=HYPERLINK("${cvUrl}", "View CV")` : '',
    ]);
  }

  return rows;
}

/** The navy title bar (merged + centred) and navy column-header row for one block. */
function blockFormatting(startRow: number, startCol: number, blockLen: number): object[] {
  if (blockLen === 0) return [];
  const headerFill = {
    repeatCell: {
      range: { sheetId: 0, startRowIndex: startRow, endRowIndex: startRow + 2, startColumnIndex: startCol, endColumnIndex: startCol + BLOCK_COLS },
      cell: {
        userEnteredFormat: {
          backgroundColor: NAVY,
          textFormat: { bold: true, foregroundColor: WHITE },
          horizontalAlignment: 'CENTER',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    },
  };
  const mergeTitle = {
    mergeCells: {
      range: { sheetId: 0, startRowIndex: startRow, endRowIndex: startRow + 1, startColumnIndex: startCol, endColumnIndex: startCol + BLOCK_COLS },
      mergeType: 'MERGE_ALL',
    },
  };
  return [headerFill, mergeTitle];
}

/** Column widths, set once — the same four columns repeat in every pair. */
function columnWidthRequests(): object[] {
  const widths = [170, 140, 120, 100];
  const requests: object[] = [];
  for (const startCol of [0, BLOCK_COLS + 1]) {
    widths.forEach((pixelSize, i) => {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: 0, dimension: 'COLUMNS', startIndex: startCol + i, endIndex: startCol + i + 1 },
          properties: { pixelSize },
          fields: 'pixelSize',
        },
      });
    });
  }
  requests.push({
    updateDimensionProperties: {
      range: { sheetId: 0, dimension: 'COLUMNS', startIndex: BLOCK_COLS, endIndex: BLOCK_COLS + 1 },
      properties: { pixelSize: 24 },
      fields: 'pixelSize',
    },
  });
  return requests;
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
  // Every room, not just ones already holding a booking — an empty room
  // still shows its block, same as the reference layout's Room 5.
  const roomsSorted = [...rooms].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const values: string[][] = [];
  const formatRequests: object[] = columnWidthRequests();
  let cursorRow = 0;

  for (let i = 0; i < roomsSorted.length; i += 2) {
    const left = roomsSorted[i];
    const right = roomsSorted[i + 1] as typeof left | undefined;

    const leftSlots = slots.filter((s) => s.room_id === left.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const leftRows = await buildRoomBlock(db, left, leftSlots, cvPathByApplication, zone);
    const rightRows = right
      ? await buildRoomBlock(
          db,
          right,
          slots.filter((s) => s.room_id === right.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
          cvPathByApplication,
          zone,
        )
      : [];

    const height = Math.max(leftRows.length, rightRows.length);
    for (let r = 0; r < height; r++) {
      values.push([...(leftRows[r] ?? blankRow()), '', ...(rightRows[r] ?? blankRow())]);
    }

    formatRequests.push(...blockFormatting(cursorRow, 0, leftRows.length));
    formatRequests.push(...blockFormatting(cursorRow, BLOCK_COLS + 1, rightRows.length));

    cursorRow += height;
    values.push(Array(PAIR_COLS).fill(''));
    cursorRow += 1;
  }

  const spreadsheetId = await ensureFloorSheet(db, edition);
  await writeFloorSheet(spreadsheetId, values, formatRequests);
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
