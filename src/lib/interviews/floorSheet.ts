import 'server-only';
import { after } from 'next/server';
import { GoogleNotConnectedError, isGoogleConfigured } from '@/lib/google/auth';
import { addTab, createFloorSheet, deleteOtherTabs, listTabs, readTab, renameTab, writeTab } from '@/lib/google/sheets';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { signCvLong } from '@/lib/interviews/cv';
import type { Actor } from '@/lib/interviews/access';
import type { Edition, Room, SlotStatus, Stage } from '@/lib/interviews/types';
import { loadRooms, loadSessions, sessionDays } from '@/lib/interviews/queries';

/**
 * Mostly a mirror — this database → the sheet — with one door back the other
 * way: the Stage column. Everything else here is regenerated wholesale on
 * every sync, so a hand-edited name or time would just be overwritten; Stage
 * is the one column worth editing by hand (an organizer at the door ticking
 * people off) and the one place `advance_stage` already refuses anything
 * that isn't a real stage, so there is a guardrail to lean on. Nothing pulls
 * automatically, though — see pullFloorSheetStages and its caller
 * (syncFloorSheetAction/pullFloorSheetAction in the interviews actions),
 * which only ever run because someone clicked a button.
 *
 * One TAB per day ("Day 1", "Day 2", …) rather than a day column: rooms are
 * now made one per day (0005's createRoomAction), so a day is naturally a
 * whole separate sheet of rooms, not a label repeated down one column.
 * Within a tab, two rooms per row, each its own block: a merged, centred,
 * navy title bar naming the room, a navy Name/Time/Phone/CV/Stage header
 * row, that room's bookings in time order. A room never names its own
 * company — here a room and its company are the same booth (0005).
 *
 * The sixth column of each block, hidden, carries the booking id — nothing
 * else in a row identifies which booking it is, and the id is what
 * pullFloorSheetStages matches an edited Stage cell back to.
 */

const STAGE_LABELS: Record<Stage, string> = {
  scheduled: 'Not Arrived',
  arrived: 'Arrived',
  in_interview: 'In Interview',
  done: 'Finished',
  no_show: 'No Show',
};
const LABEL_TO_STAGE = new Map(Object.entries(STAGE_LABELS).map(([stage, label]) => [label, stage as Stage]));

/** Same tones as STAGE_TONES (lib/interviews/ui.ts) in the app itself, as literal RGB for the Sheets API. */
const STAGE_COLORS: Record<string, { bg: { red: number; green: number; blue: number }; fg: { red: number; green: number; blue: number } }> = {
  'Not Arrived': { bg: { red: 0.9, green: 0.91, blue: 0.93 }, fg: { red: 0.29, green: 0.33, blue: 0.39 } },
  'Arrived': { bg: { red: 0.86, green: 0.92, blue: 0.99 }, fg: { red: 0.12, green: 0.25, blue: 0.69 } },
  'In Interview': { bg: { red: 1, green: 0.95, blue: 0.78 }, fg: { red: 0.57, green: 0.25, blue: 0.05 } },
  'Finished': { bg: { red: 0.86, green: 0.99, blue: 0.91 }, fg: { red: 0.09, green: 0.4, blue: 0.2 } },
  'No Show': { bg: { red: 1, green: 0.89, blue: 0.89 }, fg: { red: 0.6, green: 0.11, blue: 0.11 } },
};

const COLUMNS = ['Name', 'Time', 'Phone', 'CV', 'Stage'];
const VISIBLE_COLS = COLUMNS.length;
const ID_COL = VISIBLE_COLS; // the hidden 6th column, 0-based index within a block
const BLOCK_COLS = VISIBLE_COLS + 1;
const PAIR_COLS = BLOCK_COLS * 2 + 1; // two blocks + one gap column between them

const NAVY = { red: 0.11, green: 0.23, blue: 0.39 };
const WHITE = { red: 1, green: 1, blue: 1 };

function blankRow(): string[] {
  return Array(BLOCK_COLS).fill('');
}

function fmtTime(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(iso),
  );
}

/** `2026-10-12`, on the edition's own clock — matches how sessions.day is stored. */
function dateKey(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );
}

/** Title row, header row, then one row per booking — always BLOCK_COLS wide. */
async function buildRoomBlock(
  db: ReturnType<typeof createInterviewsClient>,
  room: Room,
  slots: SlotStatus[],
  cvPathByApplication: Map<string, string | null>,
  zone: string,
): Promise<string[][]> {
  const rows: string[][] = [
    [room.name, '', '', '', '', ''],
    [...COLUMNS, ''],
  ];

  for (const slot of slots) {
    const cvPath = slot.application_id ? cvPathByApplication.get(slot.application_id) : null;
    const cvUrl = cvPath ? await signCvLong(db, cvPath) : null;
    rows.push([
      slot.student_name ?? '',
      `${fmtTime(slot.starts_at, zone)}–${fmtTime(slot.ends_at, zone)}`,
      slot.student_phone ?? '',
      cvUrl ? `=HYPERLINK("${cvUrl}", "View CV")` : '',
      slot.stage ? STAGE_LABELS[slot.stage] : '',
      slot.booking_id ?? '',
    ]);
  }

  return rows;
}

/** The navy title bar (merged + centred), the navy header row, and a dropdown on Stage. */
function blockFormatting(sheetId: number, startRow: number, startCol: number, blockLen: number): object[] {
  if (blockLen === 0) return [];
  const requests: object[] = [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: startRow, endRowIndex: startRow + 2, startColumnIndex: startCol, endColumnIndex: startCol + BLOCK_COLS },
        cell: {
          userEnteredFormat: {
            backgroundColor: NAVY,
            textFormat: { bold: true, foregroundColor: WHITE },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    {
      mergeCells: {
        range: { sheetId, startRowIndex: startRow, endRowIndex: startRow + 1, startColumnIndex: startCol, endColumnIndex: startCol + BLOCK_COLS },
        mergeType: 'MERGE_ALL',
      },
    },
  ];

  const dataRows = blockLen - 2;
  if (dataRows > 0) {
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: startRow + 2,
          endRowIndex: startRow + 2 + dataRows,
          startColumnIndex: startCol + 4,
          endColumnIndex: startCol + 5,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: Object.values(STAGE_LABELS).map((label) => ({ userEnteredValue: label })),
          },
          showCustomUi: true,
          strict: true,
        },
      },
    });

    // One rule per stage, colouring the cell by its text — same tones as
    // the Badge on the floor board (STAGE_TONES). Recalculates the moment
    // someone picks a new value from the dropdown, unlike a plain fill.
    for (const [label, { bg, fg }] of Object.entries(STAGE_COLORS)) {
      requests.push({
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [
              {
                sheetId,
                startRowIndex: startRow + 2,
                endRowIndex: startRow + 2 + dataRows,
                startColumnIndex: startCol + 4,
                endColumnIndex: startCol + 5,
              },
            ],
            booleanRule: {
              condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: label }] },
              format: { backgroundColor: bg, textFormat: { foregroundColor: fg, bold: true } },
            },
          },
        },
      });
    }
  }

  return requests;
}

/** Column widths and the hidden booking-id column, set once per tab. */
function columnLayoutRequests(sheetId: number): object[] {
  const widths = [170, 140, 120, 100, 110];
  const requests: object[] = [];
  for (const startCol of [0, BLOCK_COLS + 1]) {
    widths.forEach((pixelSize, i) => {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: startCol + i, endIndex: startCol + i + 1 },
          properties: { pixelSize },
          fields: 'pixelSize',
        },
      });
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: startCol + ID_COL, endIndex: startCol + ID_COL + 1 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser',
      },
    });
  }
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: BLOCK_COLS, endIndex: BLOCK_COLS + 1 },
      properties: { pixelSize: 24 },
      fields: 'pixelSize',
    },
  });
  return requests;
}

/** Builds one day's full grid (every room scheduled that day, two per row) and writes it to its tab. */
async function syncDayTab(
  db: ReturnType<typeof createInterviewsClient>,
  spreadsheetId: string,
  sheetId: number,
  sheetTitle: string,
  dayRooms: Room[],
  slotsByRoom: Map<string, SlotStatus[]>,
  cvPathByApplication: Map<string, string | null>,
  zone: string,
): Promise<void> {
  const values: string[][] = [];
  const formatRequests: object[] = columnLayoutRequests(sheetId);
  let cursorRow = 0;

  for (let i = 0; i < dayRooms.length; i += 2) {
    const left = dayRooms[i];
    const right = dayRooms[i + 1] as Room | undefined;

    const leftRows = await buildRoomBlock(db, left, slotsByRoom.get(left.id) ?? [], cvPathByApplication, zone);
    const rightRows = right
      ? await buildRoomBlock(db, right, slotsByRoom.get(right.id) ?? [], cvPathByApplication, zone)
      : [];

    const height = Math.max(leftRows.length, rightRows.length);
    for (let r = 0; r < height; r++) {
      values.push([...(leftRows[r] ?? blankRow()), '', ...(rightRows[r] ?? blankRow())]);
    }

    formatRequests.push(...blockFormatting(sheetId, cursorRow, 0, leftRows.length));
    formatRequests.push(...blockFormatting(sheetId, cursorRow, BLOCK_COLS + 1, rightRows.length));

    cursorRow += height;
    values.push(Array(PAIR_COLS).fill(''));
    cursorRow += 1;
  }

  await writeTab(spreadsheetId, sheetId, sheetTitle, values, formatRequests);
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

/**
 * The tab for "Day N": reuses one already named that, otherwise claims the
 * spreadsheet's leftover default tab (its very first sync), otherwise adds
 * a fresh one. `claimed` tracks which existing tabs this run has already
 * spoken for, so two days never fight over the same unclaimed default.
 */
async function ensureDayTab(
  spreadsheetId: string,
  tabs: { sheetId: number; title: string }[],
  claimed: Set<number>,
  label: string,
): Promise<number> {
  const exact = tabs.find((t) => t.title === label);
  if (exact) {
    claimed.add(exact.sheetId);
    return exact.sheetId;
  }

  const spare = tabs.find((t) => !claimed.has(t.sheetId));
  if (spare) {
    await renameTab(spreadsheetId, spare.sheetId, label);
    spare.title = label;
    claimed.add(spare.sheetId);
    return spare.sheetId;
  }

  const sheetId = await addTab(spreadsheetId, label);
  tabs.push({ sheetId, title: label });
  claimed.add(sheetId);
  return sheetId;
}

/** Everything a full rebuild needs about the edition's current floor. */
async function loadFloorData(db: ReturnType<typeof createInterviewsClient>, editionId: string) {
  const [rooms, sessions, { data: slotRows }] = await Promise.all([
    loadRooms(db, editionId),
    loadSessions(db, editionId),
    db.from('slot_status').select('*').eq('edition_id', editionId).not('booking_id', 'is', null).order('starts_at'),
  ]);
  return { rooms, sessions, slots: (slotRows ?? []) as SlotStatus[] };
}

/** Rebuilds one edition's floor sheet from scratch. Call via kickFloorSheetSync. */
export async function syncFloorSheet(editionId: string): Promise<void> {
  if (!isGoogleConfigured()) return;

  const db = createInterviewsClient();
  const { data: editionRow } = await db.from('editions').select('*').eq('id', editionId).maybeSingle();
  const edition = editionRow as Edition | null;
  if (!edition) return;

  const { rooms, sessions, slots } = await loadFloorData(db, editionId);
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const applicationIds = [...new Set(slots.map((s) => s.application_id).filter((v): v is string => Boolean(v)))];
  const { data: applicationRows } = applicationIds.length
    ? await db.from('applications').select('id, cv_path').in('id', applicationIds)
    : { data: [] };
  const cvPathByApplication = new Map(
    ((applicationRows ?? []) as { id: string; cv_path: string | null }[]).map((a) => [a.id, a.cv_path]),
  );

  const zone = edition.time_zone;
  const days = sessionDays(sessions); // sorted 'YYYY-MM-DD', one per calendar day with a session

  const spreadsheetId = await ensureFloorSheet(db, edition);
  const tabs = await listTabs(spreadsheetId);
  const claimed = new Set<number>();
  const keepIds = new Set<number>();

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const label = `Day ${i + 1}`;

    const roomIds = [...new Set(sessions.filter((s) => s.day === day).map((s) => s.room_id))];
    const dayRooms = roomIds
      .map((id) => roomById.get(id))
      .filter((r): r is Room => Boolean(r))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    const slotsByRoom = new Map<string, SlotStatus[]>();
    for (const room of dayRooms) {
      slotsByRoom.set(
        room.id,
        slots
          .filter((s) => s.room_id === room.id && dateKey(s.starts_at, zone) === day)
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      );
    }

    const sheetId = await ensureDayTab(spreadsheetId, tabs, claimed, label);
    keepIds.add(sheetId);
    await syncDayTab(db, spreadsheetId, sheetId, label, dayRooms, slotsByRoom, cvPathByApplication, zone);
  }

  if (keepIds.size > 0) await deleteOtherTabs(spreadsheetId, keepIds);
}

/**
 * Reads every day tab's Stage column back and applies whatever it finds to
 * the matching booking — the one door back the other way (see the file
 * note). `advance_stage` is the same function the floor board's own buttons
 * call, `p_as_manager: true` so a jump straight from "Not Arrived" to
 * "Finished" is accepted the way a manager's own override already is. A row
 * whose Stage cell is blank, unrecognised, or already matches is simply not
 * counted — this never errors on a row, only reports what it did.
 *
 * Never called automatically: only from pullFloorSheetAction, when someone
 * presses the button. Nothing else in this file reads a cell.
 */
export async function pullFloorSheetStages(
  editionId: string,
  actor: Actor,
): Promise<{ updated: number; skipped: number }> {
  const db = createInterviewsClient();
  const { data: editionRow } = await db.from('editions').select('*').eq('id', editionId).maybeSingle();
  const edition = editionRow as Edition | null;
  if (!edition?.floor_sheet_id) return { updated: 0, skipped: 0 };

  const tabs = await listTabs(edition.floor_sheet_id);
  let updated = 0;
  let skipped = 0;

  for (const tab of tabs) {
    const rows = await readTab(edition.floor_sheet_id, tab.title);
    for (const row of rows) {
      for (const startCol of [0, BLOCK_COLS + 1]) {
        const bookingId = row[startCol + ID_COL];
        const stageLabel = row[startCol + 4];
        if (!bookingId || !stageLabel) continue;

        const stage = LABEL_TO_STAGE.get(stageLabel);
        if (!stage) {
          skipped++;
          continue;
        }

        const { error } = await db.rpc('advance_stage', {
          p_booking: bookingId,
          p_to: stage,
          p_actor: actor,
          p_as_manager: true,
        });
        if (error) skipped++;
        else updated++;
      }
    }
  }

  return { updated, skipped };
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
