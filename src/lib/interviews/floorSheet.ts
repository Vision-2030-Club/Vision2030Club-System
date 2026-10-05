import 'server-only';
import { isGoogleConfigured } from '@/lib/google/auth';
import {
  addTab,
  createFloorSheet,
  deleteOtherTabs,
  ensureNamedTab,
  listTabs,
  readTab,
  renameTab,
  revokeLinkSharing,
  writeTab,
} from '@/lib/google/sheets';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import {
  dayOf,
  dropdown,
  grid,
  hex,
  hideColumn,
  keptValues,
  merge,
  mergeRows,
  pages,
  paint,
  plain,
  stamp,
  STAGE_NAMES,
  timeOf,
  widths,
  type Box,
} from '@/lib/interviews/sheetFormat';
import type { Actor } from '@/lib/interviews/access';
import type { Edition, EditionSettings, Room, SlotStatus, Stage } from '@/lib/interviews/types';
import { loadCompanies, loadRooms, loadSessions, sessionDays } from '@/lib/interviews/queries';

/**
 * The floor sheet, drawn after the club's "Rooms — 5th edition" template.
 *
 * Mostly a mirror — this database → the sheet — with one door back the other
 * way: the Status column. Everything the system knows is regenerated
 * wholesale on every sync, so a hand-edited name or time would just be
 * overwritten; Status is the one column worth editing by hand (an organizer
 * at the door ticking people off) and the one place `advance_stage` already
 * refuses anything that isn't a real stage, so there is a guardrail to lean
 * on. Nothing pulls automatically, though — see pullFloorSheetStages and its
 * caller (pullFloorSheetAction in the interviews actions), which only ever
 * run because someone clicked a button. Notes are the organizers' own: read
 * off the sheet before each rewrite and put back on the same row.
 *
 * One TAB per day, named by its actual date ("9/19", "9/20", …). A day's
 * rooms come from its sessions (createRoomAction makes one per room per
 * day), so adding a room for a new day adds that day's tab. After the day
 * tabs, one "All bookings" tab lists every booking flat, for filtering and
 * counting (buildAllBookings).
 *
 * Within a day tab: a teal "DAY 1 · OCTOBER 12" banner, then rooms two side
 * by side. Each room is a block: a teal title bar naming the ROOM (its booth
 * label, uppercased) — not the company — a header row in the template's
 * mint / lavender / lime, then one row per slot of that room's session,
 * booked or not, then a ROOM SUMMARY (total, booked, available).
 *
 * Status shows the template's words, not the app's: Arrived, In-interview,
 * Completed, Late (a no-show), and Gap for a slot closed for a break; a
 * student who is booked but has not arrived shows blank. Pull from Sheet
 * reads the first four back.
 *
 * The eighth column of each block, hidden, carries the booking id (or
 * `slot:<id>` for a free slot) — nothing else in a row identifies it, and it
 * is what Pull from Sheet and the Notes carried across a rewrite match on.
 */

const STATUS_LABELS: Partial<Record<Stage, string>> = {
  arrived: 'Arrived',
  in_interview: 'In-interview',
  done: 'Completed',
  no_show: 'Late',
};
const GAP = 'Gap';
const STATUS_CHOICES = ['Arrived', 'Late', 'Completed', GAP, 'In-interview'];
const LABEL_TO_STAGE = new Map(Object.entries(STATUS_LABELS).map(([stage, label]) => [label, stage as Stage]));

// One block: Time, Company, Student Name, Student Phone Number, Status,
// Notes (two columns merged), and the hidden key.
const HEADERS = ['Time', 'Company', 'Student Name', 'Student Phone Number', 'Status', 'Notes', ''];
const STATUS_COL = 4;
const NOTES_COL = 5;
const VISIBLE_COLS = 7;
const KEY_COL = 7;
const BLOCK_COLS = 8;
const RIGHT = BLOCK_COLS + 1; // one narrow gap column between the two rooms
const PAIR_COLS = BLOCK_COLS * 2 + 1;
const BLOCKS = [0, RIGHT];

const TEAL = hex('0E5A67');
const WHITE = hex('FFFFFF');
const MINT = hex('A6EDDD');
const LAVENDER = hex('C2B7EF');
const LIME = hex('C3F04A');
const NOTES_LINE = hex('D7D7D7');
/** Header colour, then the paler tint of the same colour for the rows under it. */
const COLUMN_TONES = [
  { head: MINT, row: hex('EAF9F6') },
  { head: LAVENDER, row: hex('F0ECFB') },
  { head: LIME, row: hex('F3FBD7') },
  { head: MINT, row: hex('EAF9F6') },
  { head: LAVENDER, row: hex('F0ECFB') },
  { head: MINT, row: hex('F8F6FC') },
  { head: MINT, row: hex('F8F6FC') },
];

/** The flat tab after the day tabs (buildAllBookings). */
const ALL_TAB = 'All bookings';
const ALL_COLUMNS = [
  'Day',
  'Time',
  'Room',
  'Company',
  'Student',
  'Phone',
  'Status',
  'Arrived',
  'Started',
  'Finished',
  'Booked at',
  'Booked by',
];

/** "OCTOBER 12" — the date in the banner of each day tab. */
function dayTitle(day: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' })
    .format(new Date(`${day}T12:00:00Z`))
    .toUpperCase();
}

function blankRow(): string[] {
  return Array(BLOCK_COLS).fill('');
}

function rowKey(slot: SlotStatus): string {
  return slot.booking_id ?? `slot:${slot.id}`;
}

function statusOf(slot: SlotStatus): string {
  if (slot.booking_id) return slot.stage ? (STATUS_LABELS[slot.stage] ?? '') : '';
  return slot.is_closed ? GAP : '';
}

type RoomBlock = { title: string; slots: SlotStatus[]; rows: string[][] };

/** One row per slot of the room's session, booked or not, always BLOCK_COLS wide. */
function buildRoomBlock(room: Room, companyName: string, slots: SlotStatus[], notes: Map<string, string>, zone: string): RoomBlock {
  return {
    title: room.name.toUpperCase(),
    slots,
    rows: slots.map((slot) => [
      timeOf(slot.starts_at, zone),
      plain(companyName),
      plain(slot.student_name),
      plain(slot.student_phone),
      statusOf(slot),
      notes.get(rowKey(slot)) ?? '',
      '',
      rowKey(slot),
    ]),
  };
}

/**
 * One room's block at (row, col): title bar, header row, its slot rows, and
 * below them (at `summaryRow`, shared by the two rooms of a pair so they line
 * up) the room summary.
 */
function blockFormatting(sheetId: number, row: number, col: number, block: RoomBlock, summaryRow: number): object[] {
  const box = (r0: number, r1: number, c0: number, c1: number): Box => ({ sheetId, r0, r1, c0: col + c0, c1: col + c1 });
  const first = row + 2;
  const last = first + block.rows.length;

  const requests: object[] = [
    paint(box(row, row + 1, 0, VISIBLE_COLS), { bg: TEAL, fg: WHITE, bold: true, size: 14, align: 'CENTER' }),
    merge(box(row, row + 1, 0, VISIBLE_COLS)),
    ...COLUMN_TONES.map((tone, c) =>
      paint(box(row + 1, row + 2, c, c + 1), { bg: tone.head, fg: TEAL, bold: true, align: 'CENTER' }),
    ),
    merge(box(row + 1, row + 2, NOTES_COL, NOTES_COL + 2)),
    // The summary: a teal label, then Total / Booked / Available.
    paint(box(summaryRow, summaryRow + 1, 0, 2), { bg: TEAL, fg: WHITE, bold: true, align: 'CENTER' }),
    merge(box(summaryRow, summaryRow + 1, 0, 2)),
    paint(box(summaryRow, summaryRow + 1, 2, VISIBLE_COLS), { bg: MINT, fg: TEAL, bold: true, align: 'CENTER' }),
    merge(box(summaryRow, summaryRow + 1, 4, VISIBLE_COLS)),
    paint(box(summaryRow + 1, summaryRow + 2, 2, VISIBLE_COLS), { bg: WHITE, fg: TEAL, bold: true, align: 'CENTER' }),
    merge(box(summaryRow + 1, summaryRow + 2, 4, VISIBLE_COLS)),
  ];

  if (block.rows.length > 0) {
    requests.push(
      ...COLUMN_TONES.map((tone, c) =>
        paint(box(first, last, c, c + 1), c === 0 ? { bg: tone.row, fg: TEAL, bold: true, align: 'CENTER' } : { bg: tone.row }),
      ),
      mergeRows(box(first, last, NOTES_COL, NOTES_COL + 2)),
      grid(box(row + 1, last, NOTES_COL, NOTES_COL + 2), NOTES_LINE),
      dropdown(box(first, last, STATUS_COL, STATUS_COL + 1), STATUS_CHOICES),
    );
  }
  return requests;
}

/** The two-row summary under a room: labels, then the counts. */
function summaryRows(block: RoomBlock | undefined): [string[], string[]] {
  if (!block) return [blankRow(), blankRow()];
  const total = block.slots.filter((s) => s.booking_id || !s.is_closed).length;
  const booked = block.slots.filter((s) => s.booking_id).length;
  return [
    ['ROOM SUMMARY', '', 'Total Slots', 'Booked', 'Available', '', '', ''],
    ['', '', String(total), String(booked), String(total - booked), '', '', ''],
  ];
}

/** Builds one day's full grid (every room scheduled that day, two per row) and writes it to its tab. */
async function syncDayTab(
  spreadsheetId: string,
  sheetId: number,
  sheetTitle: string,
  titleText: string,
  dayRooms: Room[],
  slotsByRoom: Map<string, SlotStatus[]>,
  companyNameByRoom: Map<string, string>,
  zone: string,
): Promise<void> {
  // Notes are the organizers' own; carry them across the rewrite.
  const notes = keptValues(await readTab(spreadsheetId, sheetTitle), BLOCKS, KEY_COL, NOTES_COL);

  const values: string[][] = [
    [titleText, ...Array(PAIR_COLS - 1).fill('')],
    Array(PAIR_COLS).fill(''),
    Array(PAIR_COLS).fill(''),
    Array(PAIR_COLS).fill(''),
  ];
  const banner: Box = { sheetId, r0: 0, r1: 3, c0: 0, c1: PAIR_COLS };
  const formatRequests: object[] = [
    ...widths(sheetId, 0, [86, 120, 170, 150, 110, 90, 130]),
    ...widths(sheetId, RIGHT, [86, 120, 170, 150, 110, 90, 130]),
    ...widths(sheetId, BLOCK_COLS, [30]),
    hideColumn(sheetId, KEY_COL),
    hideColumn(sheetId, RIGHT + KEY_COL),
    paint(banner, { bg: TEAL, fg: WHITE, bold: true, size: 20, align: 'CENTER' }),
    merge(banner),
  ];
  let cursorRow = values.length;

  for (let i = 0; i < dayRooms.length; i += 2) {
    const left = dayRooms[i];
    const right = dayRooms[i + 1] as Room | undefined;
    const blockOf = (room: Room) =>
      buildRoomBlock(room, companyNameByRoom.get(room.id) ?? '', slotsByRoom.get(room.id) ?? [], notes, zone);
    const leftBlock = blockOf(left);
    const rightBlock = right ? blockOf(right) : undefined;

    const titleRow = (block?: RoomBlock) => (block ? [block.title, ...Array(BLOCK_COLS - 1).fill('')] : blankRow());
    const headerRow = (block?: RoomBlock) => (block ? [...HEADERS, ''] : blankRow());
    values.push([...titleRow(leftBlock), '', ...titleRow(rightBlock)]);
    values.push([...headerRow(leftBlock), '', ...headerRow(rightBlock)]);

    const height = Math.max(leftBlock.rows.length, rightBlock?.rows.length ?? 0);
    for (let r = 0; r < height; r++) {
      values.push([...(leftBlock.rows[r] ?? blankRow()), '', ...(rightBlock?.rows[r] ?? blankRow())]);
    }
    values.push(Array(PAIR_COLS).fill(''));

    const summaryRow = cursorRow + 2 + height + 1;
    const [leftLabels, leftCounts] = summaryRows(leftBlock);
    const [rightLabels, rightCounts] = summaryRows(rightBlock);
    values.push([...leftLabels, '', ...rightLabels]);
    values.push([...leftCounts, '', ...rightCounts]);

    formatRequests.push(...blockFormatting(sheetId, cursorRow, 0, leftBlock, summaryRow));
    if (rightBlock) formatRequests.push(...blockFormatting(sheetId, cursorRow, RIGHT, rightBlock, summaryRow));

    values.push(Array(PAIR_COLS).fill(''), Array(PAIR_COLS).fill(''));
    cursorRow = values.length;
  }

  await writeTab(spreadsheetId, sheetId, sheetTitle, values, formatRequests);
}

/**
 * Where the floor sheet is remembered. 0006 added `floor_sheet_id` for it, but
 * 0006 never reached the real project, and `set_floor_sheet` failing there
 * was ignored, so every sync made a new spreadsheet and none was ever
 * remembered. Now the id and link live in the edition's settings
 * (`floor_sheet_id`, `floor_sheet_url`), like the registrations sheet; the
 * column still counts where 0006 did run.
 */
async function savedFloorSheet(
  db: ReturnType<typeof createInterviewsClient>,
  edition: Edition,
): Promise<string | null> {
  if (edition.floor_sheet_id) return edition.floor_sheet_id;
  const { data } = await db.rpc('edition_settings', { p_edition: edition.id });
  const id = (data as EditionSettings | null)?.floor_sheet_id;
  return typeof id === 'string' && id ? id : null;
}

async function ensureFloorSheet(
  db: ReturnType<typeof createInterviewsClient>,
  edition: Edition,
): Promise<string> {
  const saved = await savedFloorSheet(db, edition);
  if (saved) return saved;

  const created = await createFloorSheet(`${edition.name_en} — Floor`);
  const { error } = await db.rpc('update_edition', {
    p_edition: edition.id,
    p_patch: { settings: { floor_sheet_id: created.id, floor_sheet_url: created.url } },
    p_actor: { kind: 'system', name: 'Floor sheet' },
  });
  if (error) throw new Error(error.message);
  return created.id;
}

/** Everything a full rebuild needs about the edition's current floor. */
async function loadFloorData(db: ReturnType<typeof createInterviewsClient>, editionId: string) {
  const [rooms, sessions, slots] = await Promise.all([
    loadRooms(db, editionId),
    loadSessions(db, editionId),
    pages<SlotStatus>((from, to) =>
      db.from('slot_status').select('*').eq('edition_id', editionId).order('starts_at').order('id').range(from, to),
    ),
  ]);
  return { rooms, sessions, slots };
}

/** Rebuilds one edition's floor sheet from scratch. Call via kickSheetsSync (sheetsSync.ts). */
export async function syncFloorSheet(editionId: string): Promise<void> {
  if (!isGoogleConfigured()) return;

  const db = createInterviewsClient();
  const { data: editionRow } = await db.from('editions').select('*').eq('id', editionId).maybeSingle();
  const edition = editionRow as Edition | null;
  if (!edition) return;

  const { rooms, sessions: allSessions, slots } = await loadFloorData(db, editionId);
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  // Room and company are named separately now — the room is a booth label
  // ("Room 1"), the company is whoever's session is scheduled in it, read
  // through sessions rather than assumed equal to the room's own name.
  const companies = await loadCompanies(db, editionId);
  const companyById = new Map(companies.map((c) => [c.id, c]));

  // A "deleted" room/company is only soft-deleted (is_active/is_hidden) so
  // the sheet's past history survives — but a rebuilt sheet should never
  // show it going forward, same as the app's own Rooms page hides it. Drop
  // its sessions here, before anything downstream (days, room blocks) ever
  // sees them.
  const sessions = allSessions.filter(
    (s) => roomById.get(s.room_id)?.is_active && !companyById.get(s.company_id)?.is_hidden,
  );

  const companyNameByRoom = new Map<string, string>();
  for (const session of sessions) {
    if (companyNameByRoom.has(session.room_id)) continue;
    const company = companyById.get(session.company_id);
    if (company) companyNameByRoom.set(session.room_id, company.name_en);
  }

  const zone = edition.time_zone;
  const days = sessionDays(sessions); // sorted 'YYYY-MM-DD', one per calendar day with a session

  const spreadsheetId = await ensureFloorSheet(db, edition);
  await revokeLinkSharing(spreadsheetId);
  const tabs = await listTabs(spreadsheetId);

  if (days.length === 0) {
    // Nothing scheduled at all (e.g. everything was just wiped for a fresh
    // test run). deleteOtherTabs never empties a spreadsheet completely —
    // Google requires at least one sheet — so the loop below would leave
    // every old tab behind with no day left to reclaim it. Keep exactly one,
    // cleared and neutrally named, and drop the rest explicitly here.
    const placeholder = 'No rooms yet';
    const keep = tabs[0];
    if (keep) {
      if (keep.title !== placeholder) await renameTab(spreadsheetId, keep.sheetId, placeholder);
      await writeTab(spreadsheetId, keep.sheetId, placeholder, [['No rooms are scheduled yet.']]);
      await deleteOtherTabs(spreadsheetId, new Set([keep.sheetId]));
    }
    return;
  }

  const claimed = new Set<number>();
  const keepIds = new Set<number>();
  // Spoken for before the days are, so a new day never renames it.
  const allTab = tabs.find((t) => t.title === ALL_TAB);
  if (allTab) {
    claimed.add(allTab.sheetId);
    keepIds.add(allTab.sheetId);
  }

  const liveSessions = new Set(sessions.map((s) => s.id));
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    // day is already 'YYYY-MM-DD' on the edition's own clock (sessions.day) —
    // no Date/timezone conversion needed, just reformat it as "9/19".
    const [, month, dayOfMonth] = day.split('-');
    const label = `${Number(month)}/${Number(dayOfMonth)}`;

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
          .filter((s) => s.room_id === room.id && liveSessions.has(s.session_id) && dayOf(s.starts_at, zone) === day)
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      );
    }

    const sheetId = await ensureNamedTab(spreadsheetId, tabs, claimed, label);
    keepIds.add(sheetId);
    await syncDayTab(spreadsheetId, sheetId, label, `DAY ${i + 1} · ${dayTitle(day)}`, dayRooms, slotsByRoom, companyNameByRoom, zone);
  }

  const allSheetId = allTab?.sheetId ?? (await addTab(spreadsheetId, ALL_TAB));
  keepIds.add(allSheetId);
  const allRows = await buildAllBookings(db, editionId, liveSessions, slots, roomById, companyNameByRoom, zone);
  const header: Box = { sheetId: allSheetId, r0: 0, r1: 1, c0: 0, c1: ALL_COLUMNS.length };
  await writeTab(spreadsheetId, allSheetId, ALL_TAB, allRows, [
    paint(header, { bg: TEAL, fg: WHITE, bold: true }),
    {
      updateSheetProperties: {
        properties: { sheetId: allSheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
  ]);

  await deleteOtherTabs(spreadsheetId, keepIds);
}

/**
 * The "All bookings" tab: every live booking of the edition on one flat,
 * filterable list, with the times the floor recorded for it — what the day
 * tabs, laid out room by room for the people at the door, cannot be sorted
 * or counted by. Same rooms as the day tabs: a deleted room or company is
 * left out. Its Status column is NOT read back by Pull from Sheet; that is
 * the day tabs' job.
 */
async function buildAllBookings(
  db: ReturnType<typeof createInterviewsClient>,
  editionId: string,
  liveSessions: Set<string>,
  slots: SlotStatus[],
  roomById: Map<string, Room>,
  companyNameByRoom: Map<string, string>,
  zone: string,
): Promise<string[][]> {
  const slotById = new Map(slots.filter((s) => liveSessions.has(s.session_id)).map((s) => [s.id, s]));

  const bookings = await pages<{
    id: string;
    slot_id: string;
    starts_at: string;
    stage: Stage;
    arrived_at: string | null;
    started_at: string | null;
    finished_at: string | null;
    booked_at: string;
    booked_by_kind: string;
  }>((from, to) =>
    db
      .from('bookings')
      .select('id, slot_id, starts_at, stage, arrived_at, started_at, finished_at, booked_at, booked_by_kind')
      .eq('edition_id', editionId)
      .is('cancelled_at', null)
      .order('starts_at')
      .order('id')
      .range(from, to),
  );

  const rows: string[][] = [ALL_COLUMNS];
  for (const booking of bookings) {
    const slot = slotById.get(booking.slot_id);
    if (!slot) continue;
    rows.push([
      dayOf(booking.starts_at, zone),
      timeOf(booking.starts_at, zone),
      plain(roomById.get(slot.room_id)?.name),
      plain(companyNameByRoom.get(slot.room_id)),
      plain(slot.student_name),
      plain(slot.student_phone),
      STAGE_NAMES[booking.stage] ?? booking.stage,
      timeOf(booking.arrived_at, zone),
      timeOf(booking.started_at, zone),
      timeOf(booking.finished_at, zone),
      stamp(booking.booked_at, zone),
      booking.booked_by_kind === 'staff' ? 'Staff' : 'Student',
    ]);
  }
  return rows;
}

/**
 * Reads every day tab's Status column back and applies whatever changed to
 * the matching booking — the one door back the other way (see the file
 * note). `advance_stage` is the same function the floor board's own buttons
 * call, `p_as_manager: true` so a jump straight from not-arrived to
 * Completed is accepted the way a manager's own override already is. A row
 * whose Status is blank, Gap, unrecognised, or already what the system
 * holds is left alone — this never errors on a row, only reports what it
 * did.
 *
 * Never called automatically: only from pullFloorSheetAction, when someone
 * presses the button.
 */
export async function pullFloorSheetStages(
  editionId: string,
  actor: Actor,
): Promise<{ updated: number; skipped: number }> {
  const db = createInterviewsClient();
  const { data: editionRow } = await db.from('editions').select('*').eq('id', editionId).maybeSingle();
  const edition = editionRow as Edition | null;
  const sheetId = edition ? await savedFloorSheet(db, edition) : null;
  if (!sheetId) return { updated: 0, skipped: 0 };

  const current = new Map(
    (
      await pages<{ id: string; stage: Stage }>((from, to) =>
        db.from('bookings').select('id, stage').eq('edition_id', editionId).is('cancelled_at', null).order('id').range(from, to),
      )
    ).map((b) => [b.id, b.stage]),
  );

  const tabs = await listTabs(sheetId);
  let updated = 0;
  let skipped = 0;

  for (const tab of tabs) {
    if (tab.title === ALL_TAB) continue;
    const rows = await readTab(sheetId, tab.title);
    for (const row of rows) {
      for (const startCol of BLOCKS) {
        const bookingId = row[startCol + KEY_COL];
        const label = row[startCol + STATUS_COL];
        if (!bookingId || !label || !current.has(bookingId) || label === GAP) continue;

        const stage = LABEL_TO_STAGE.get(label);
        if (!stage) {
          skipped++;
          continue;
        }
        if (current.get(bookingId) === stage) continue;

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
