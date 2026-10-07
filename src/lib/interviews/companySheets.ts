import 'server-only';
import { GoogleNotConnectedError, isGoogleConfigured } from '@/lib/google/auth';
import {
  createSpreadsheet,
  deleteOtherTabs,
  ensureNamedTab,
  forgetWritten,
  listTabs,
  readAllTabs,
  rememberWritten,
  revokeLinkSharing,
  writeTab,
  writtenAlready,
} from '@/lib/google/sheets';
import { siteUrl } from '@/lib/interviews/email';
import { loadCompanies, loadRooms, loadSessions } from '@/lib/interviews/queries';
import {
  dayOf,
  dropdown,
  grid,
  hex,
  hideColumn,
  keptValues,
  merge,
  pages,
  paint,
  plain,
  timeOf,
  whenText,
  widths,
  type Box,
} from '@/lib/interviews/sheetFormat';
import type { Company, Edition, EditionSettings, Room, SlotStatus, Stage } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import {
  addResults,
  applySheetEdits,
  editsIn,
  emptyResult,
  encodeBase,
  type PullResult,
  type PullRules,
  type SheetEdit,
} from '@/lib/interviews/sheetPull';

/**
 * A Google Sheet per company AND room, drawn after the club's "Company
 * Template — 5th edition": STC interviewing in Room 1 and Room 2 has two
 * files, one per room, each with one tab per day ("10/12") like the floor
 * sheet's tabs. A file shows only its company's own hours in that room: when
 * STC has Room 1 from 2 to 5 and PwC from 5 to 8, STC's file lists 2–5 and
 * PwC's lists 5–8. The floor sheet is where the whole room is seen.
 *
 * Each tab: the edition's name on a teal banner, a lime stripe, the
 * COMPANY / DATE / ROOM labels with their values, then one row per slot of
 * the company's session in that room that day, booked or not — Time,
 * Interviewer, Student Name, Phone Number, Student CV, Feedback Link, Status.
 *
 * Created when a manager presses "Create Google Sheets" on the company's card
 * on the Rooms tab: one file for every room the company has a session in.
 * From then on the company counts as opted in, and a room it is given later
 * gets its file on the next sync. Owned by the club's Google account like the
 * other sheets. Nothing shares a file automatically: HR opens it from that
 * account and shares it with the company's people by name. Link sharing is
 * switched off on every rebuild. It carries students' phone numbers, by the
 * club's decision of 2026-10-05, as the template does.
 *
 * Who writes what:
 *   - Status goes both ways: the floor's stage as the template's words
 *     (Interview Done, No Show, In-progress), blank before that; and a word
 *     the company picks there becomes the booking's stage (sheetPull.ts:
 *     compare-and-set against the hidden base column, ninth, so the app wins
 *     whenever it moved the student since, and a file can only move its own
 *     company's bookings in its own room).
 *   - Interviewer starts as the company's name on every slot, and is the
 *     company's to change: a person's name typed over it is read before each
 *     rewrite and put back on its time slot (keyed by the hidden eighth
 *     column, the slot id). A cleared cell goes back to the company's name.
 *   - The CV link is the interviewer page's own (`/api/interviews/cv?token=…`):
 *     it opens only a CV of a student booked with THIS company, and only after
 *     the company's PIN, if it has one. The Feedback link opens the interviewer
 *     page on that student's day with their feedback form open. A new
 *     interviewer link (rotateCompanyTokenAction) changes both, and the next
 *     sync rewrites them.
 *
 * Rebuilt after every booking or stage change (sheetsSync.ts), skipping
 * Google entirely for a file whose rows did not change; "Sync now" on the
 * card always rewrites. Kept in the edition's settings as `company_sheets`
 * ({ "<company id>:<room id>": { id, url } }), so it needs no migration.
 */

const HEADERS = ['Time', 'Interviewer', 'Student Name', 'Phone Number', 'Student CV', 'Feedback Link', 'Status'];
const INTERVIEWER_COL = 1;
const STATUS_COL = 6;
const VISIBLE_COLS = 7;
const KEY_COL = 7;
/** Hidden: `<booking id>|<stage>`, the Status the system last wrote (sheetPull.ts). */
const BASE_COL = 8;
const FIRST_SLOT_ROW = 6;

const STATUS_LABELS: Partial<Record<Stage, string>> = {
  done: 'Interview Done',
  no_show: 'No Show',
  in_interview: 'In-progress',
};
const STATUS_CHOICES = ['Interview Done', 'No Show', 'In-progress'];
const LABEL_TO_STAGE = new Map(Object.entries(STATUS_LABELS).map(([stage, label]) => [label, stage as Stage]));

const BANNER = hex('326F75');
const INK = hex('163E43');
const WHITE = hex('FFFFFF');
const MINT = hex('A6EDDD');
const LAVENDER = hex('C2B7EF');
const LIME = hex('C3F04A');
const GREY = hex('D9D9D9');
const LINE = hex('AAC1C1');

type Db = ReturnType<typeof createInterviewsClient>;
type Saved = { id: string; url: string };

/** One company in one room: the unit a file is made for. */
type Pair = { company: Company; room: Room };

/** One day of one pair: what its tab says, before any hand-typed Interviewer is put back. */
type DayTab = { label: string; rows: string[][] };

/** How a pair is keyed in the edition's `company_sheets` setting. */
export function sheetKey(companyId: string, roomId: string): string {
  return `${companyId}:${roomId}`;
}

/** The edition's company sheets, by sheetKey, ignoring anything malformed. */
export function companySheets(settings: { company_sheets?: unknown } | null | undefined): Record<string, Saved> {
  const saved = settings?.company_sheets;
  if (!saved || typeof saved !== 'object') return {};
  return Object.fromEntries(
    Object.entries(saved as Record<string, unknown>).filter((entry): entry is [string, Saved] => {
      const v = entry[1] as Partial<Saved> | null;
      return entry[0].includes(':') && Boolean(v && typeof v.id === 'string' && typeof v.url === 'string');
    }),
  );
}

/** True once any of the company's rooms has a file: its later rooms get one automatically. */
function optedIn(sheets: Record<string, Saved>, companyId: string): boolean {
  return Object.keys(sheets).some((key) => key.startsWith(`${companyId}:`));
}

async function savedSheets(db: Db, editionId: string): Promise<Record<string, Saved>> {
  const { data } = await db.rpc('edition_settings', { p_edition: editionId });
  return companySheets(data as EditionSettings | null);
}

/** Remembers one pair's file, read fresh so two quick creations do not undo each other. */
async function saveSheet(db: Db, editionId: string, key: string, sheet: Saved): Promise<void> {
  const sheets = { ...(await savedSheets(db, editionId)), [key]: sheet };
  const { error } = await db.rpc('update_edition', {
    p_edition: editionId,
    p_patch: { settings: { company_sheets: sheets } },
    p_actor: { kind: 'system', name: 'Company sheet' },
  });
  if (error) throw new Error(error.message);
}

/** "October 12, 2026" for a 'YYYY-MM-DD' day. */
function longDate(day: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

function tabLabel(day: string): string {
  const [, month, dayOfMonth] = day.split('-');
  return `${Number(month)}/${Number(dayOfMonth)}`;
}

/**
 * Every company-and-room pair with a session: live rooms and visible
 * companies only, the way the floor sheet leaves out a deleted room.
 */
async function loadPairs(db: Db, editionId: string, companyIds?: Set<string>): Promise<Pair[]> {
  const [companies, rooms, sessions] = await Promise.all([
    loadCompanies(db, editionId),
    loadRooms(db, editionId),
    loadSessions(db, editionId),
  ]);
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const pairs: Pair[] = [];
  for (const s of sessions) {
    const company = companyById.get(s.company_id);
    const room = roomById.get(s.room_id);
    if (!company || !room || company.is_hidden || !room.is_active) continue;
    if (companyIds && !companyIds.has(company.id)) continue;
    const key = sheetKey(company.id, room.id);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ company, room });
  }
  return pairs.sort(
    (a, b) => a.company.sort_order - b.company.sort_order || a.room.sort_order - b.room.sort_order || a.room.name.localeCompare(b.room.name),
  );
}

/** Every pair's day tabs, built from one read of the edition's floor. */
async function loadTabs(db: Db, edition: Edition, pairs: Pair[]): Promise<Map<string, DayTab[]>> {
  const wanted = new Set(pairs.map((p) => sheetKey(p.company.id, p.room.id)));
  const allSlots = await pages<SlotStatus>((from, to) =>
    db.from('slot_status').select('*').eq('edition_id', edition.id).order('starts_at').order('id').range(from, to),
  );
  const slots = allSlots.filter((s) => wanted.has(sheetKey(s.company_id, s.room_id)));

  const applicationIds = [...new Set(slots.map((s) => s.application_id).filter((v): v is string => Boolean(v)))];
  const withCv = new Set<string>();
  const externalCv = new Map<string, string>();
  for (let i = 0; i < applicationIds.length; i += 200) {
    const { data } = await db
      .from('applications')
      .select('id, cv_path, cv_external_url')
      .in('id', applicationIds.slice(i, i + 200));
    for (const a of (data ?? []) as { id: string; cv_path: string | null; cv_external_url: string | null }[]) {
      if (a.cv_path) withCv.add(a.id);
      else if (a.cv_external_url) externalCv.set(a.id, a.cv_external_url);
    }
  }

  const zone = edition.time_zone;
  const banner = edition.name_ar || edition.name_en;
  const out = new Map<string, DayTab[]>();

  for (const { company, room } of pairs) {
    const byDay = new Map<string, SlotStatus[]>();
    for (const slot of slots) {
      if (slot.company_id !== company.id || slot.room_id !== room.id) continue;
      const day = dayOf(slot.starts_at, zone);
      byDay.set(day, [...(byDay.get(day) ?? []), slot]);
    }

    const tabs: DayTab[] = [...byDay.keys()].sort().map((day) => {
      const pad = (cells: string[]) => [...cells, ...Array(BASE_COL + 1 - cells.length).fill('')];
      const rows: string[][] = [
        pad([banner]),
        pad([]),
        pad([]),
        pad(['COMPANY  /  الشركة', '', '', 'DATE  /  التاريخ', '', 'ROOM  /  الغرفة']),
        pad([plain(company.name_en), '', '', longDate(day), '', plain(room.name)]),
        pad(HEADERS),
      ];
      for (const slot of byDay.get(day)!) {
        const booking = slot.booking_id;
        const application = slot.application_id;
        const cv =
          booking && application && withCv.has(application)
            ? `=HYPERLINK("${siteUrl()}/api/interviews/cv?token=${company.access_token}&booking=${booking}", "View CV")`
            : application && externalCv.has(application)
              ? `=HYPERLINK("${externalCv.get(application)!.replace(/"/g, '""')}", "View CV")`
              : '';
        const feedback = booking
          ? `=HYPERLINK("${siteUrl()}/en/interviews/c/${company.access_token}?day=${day}&open=${booking}#b-${booking}", "Feedback")`
          : '';
        rows.push([
          timeOf(slot.starts_at, zone),
          // The company itself until someone types a person's name over it.
          plain(company.name_en),
          booking ? plain(slot.student_name) : '',
          booking ? plain(slot.student_phone) : '',
          cv,
          feedback,
          booking && slot.stage ? (STATUS_LABELS[slot.stage] ?? '') : '',
          `slot:${slot.id}`,
          booking && slot.stage ? encodeBase(booking, slot.stage) : '',
        ]);
      }
      return { label: tabLabel(day), rows };
    });
    out.set(sheetKey(company.id, room.id), tabs);
  }
  return out;
}

/** The template's look for one day tab with `slotCount` slot rows. */
function tabFormatting(sheetId: number, slotCount: number): object[] {
  const box = (r0: number, r1: number, c0: number, c1: number): Box => ({ sheetId, r0, r1, c0, c1 });
  const end = FIRST_SLOT_ROW + slotCount;
  const label = { fg: INK, bold: true } as const;
  const requests: object[] = [
    ...widths(sheetId, 0, [80, 115, 160, 115, 150, 100, 120]),
    hideColumn(sheetId, KEY_COL),
    hideColumn(sheetId, BASE_COL),
    paint(box(0, 2, 0, VISIBLE_COLS), { bg: BANNER, fg: WHITE, bold: true, size: 18, align: 'CENTER' }),
    merge(box(0, 2, 0, VISIBLE_COLS)),
    paint(box(2, 3, 0, VISIBLE_COLS), { bg: LIME }),
    merge(box(2, 3, 0, VISIBLE_COLS)),
    paint(box(3, 4, 0, 3), { ...label, bg: MINT }),
    paint(box(3, 4, 3, 5), { ...label, bg: LAVENDER }),
    paint(box(3, 4, 5, 7), { ...label, bg: MINT }),
    paint(box(4, 5, 0, VISIBLE_COLS), { bg: GREY, fg: BANNER, bold: true }),
    ...[
      [0, 3],
      [3, 5],
      [5, 7],
    ].flatMap(([c0, c1]) => [merge(box(3, 4, c0, c1)), merge(box(4, 5, c0, c1))]),
    paint(box(5, 6, 0, VISIBLE_COLS), { bg: BANNER, fg: WHITE, bold: true }),
  ];
  if (slotCount > 0) {
    requests.push(
      paint(box(FIRST_SLOT_ROW, end, 0, 1), { fg: INK, bold: true }),
      paint(box(FIRST_SLOT_ROW, end, 1, VISIBLE_COLS), { fg: INK }),
      dropdown(box(FIRST_SLOT_ROW, end, STATUS_COL, STATUS_COL + 1), STATUS_CHOICES),
      whenText(box(FIRST_SLOT_ROW, end, STATUS_COL, STATUS_COL + 1), 'No Show', { bg: LAVENDER, fg: INK }),
      whenText(box(FIRST_SLOT_ROW, end, STATUS_COL, STATUS_COL + 1), 'Interview Done', { bg: MINT, fg: INK }),
    );
  }
  requests.push(grid(box(3, end, 0, VISIBLE_COLS), LINE));
  return requests;
}

/** How a company's Status words map to stages, and the one company and room its file may move. */
function companyRules(pair: Pair): PullRules {
  return {
    labelOf: (stage) => STATUS_LABELS[stage] ?? '',
    stageOf: (label) => LABEL_TO_STAGE.get(label),
    actor: { kind: 'company', id: pair.company.id, name: `${pair.company.name_en} (Google Sheet, ${pair.room.name})` },
    mayChange: (b) => b.company_id === pair.company.id && b.room_id === pair.room.id,
  };
}

function companyEdits(tabs: Map<string, string[][]>, rules: PullRules): SheetEdit[] {
  return [...tabs.values()].flatMap((rows) => editsIn(rows.slice(FIRST_SLOT_ROW), [0], BASE_COL, STATUS_COL, rules));
}

/** Applies the Status edits waiting in one pair's file, read in one request. */
async function pullPair(pair: Pair, spreadsheetId: string, tabs?: Map<string, string[][]>): Promise<PullResult> {
  const rules = companyRules(pair);
  return applySheetEdits(companyEdits(tabs ?? (await readAllTabs(spreadsheetId)), rules), rules);
}

/**
 * Writes every day tab of one pair's file. Reads it first, in one request:
 * Status edits waiting there are applied before anything is overwritten
 * (and the rows rebuilt if one moved a booking), and the names typed under
 * Interviewer are carried across.
 */
async function writeSheet(db: Db, edition: Edition, pair: Pair, spreadsheetId: string, built: DayTab[]): Promise<PullResult> {
  await revokeLinkSharing(spreadsheetId);
  const written = await readAllTabs(spreadsheetId);
  const pulled = await pullPair(pair, spreadsheetId, written);
  const tabs = pulled.applied
    ? ((await loadTabs(db, edition, [pair])).get(sheetKey(pair.company.id, pair.room.id)) ?? [])
    : built;

  const interviewers = new Map<string, string>();
  for (const rows of written.values()) {
    for (const [key, name] of keptValues(rows.slice(FIRST_SLOT_ROW), [0], KEY_COL, INTERVIEWER_COL)) {
      // The company's own name is the default, not something typed: leave it
      // to the rows, so a renamed company is renamed here too.
      if (name !== pair.company.name_en) interviewers.set(key, name);
    }
  }

  const existing = await listTabs(spreadsheetId);
  const claimed = new Set<number>();
  const keep = new Set<number>();

  if (tabs.length === 0) {
    // Google keeps at least one tab; say why it is empty rather than leave an old day behind.
    const label = 'No interviews yet';
    const sheetId = await ensureNamedTab(spreadsheetId, existing, claimed, label);
    keep.add(sheetId);
    await writeTab(spreadsheetId, sheetId, label, [['No interviews are scheduled here yet.']]);
  }

  for (const tab of tabs) {
    const sheetId = await ensureNamedTab(spreadsheetId, existing, claimed, tab.label);
    keep.add(sheetId);
    const rows = tab.rows.map((row, i) =>
      i >= FIRST_SLOT_ROW && interviewers.has(row[KEY_COL])
        ? row.map((cell, c) => (c === INTERVIEWER_COL ? interviewers.get(row[KEY_COL])! : cell))
        : row,
    );
    await writeTab(spreadsheetId, sheetId, tab.label, rows, tabFormatting(sheetId, tab.rows.length - FIRST_SLOT_ROW));
  }

  await deleteOtherTabs(spreadsheetId, keep);
  rememberWritten(`company:${spreadsheetId}`, tabs);
  return pulled;
}

async function loadEdition(db: Db, editionId: string): Promise<Edition | null> {
  const { data } = await db.from('editions').select('*').eq('id', editionId).maybeSingle();
  return data as Edition | null;
}

/** The pair's file, created and remembered the first time it is needed. */
async function ensureSheet(db: Db, edition: Edition, pair: Pair, sheets: Record<string, Saved>): Promise<Saved> {
  const key = sheetKey(pair.company.id, pair.room.id);
  const saved = sheets[key];
  if (saved) return saved;
  const created = await createSpreadsheet(`${edition.name_en} — ${pair.company.name_en} — ${pair.room.name}`, 'Schedule');
  await saveSheet(db, edition.id, key, created);
  sheets[key] = created;
  return created;
}

/**
 * The Rooms tab's "Create Google Sheets" and "Sync now": creates a file for
 * each of the company's rooms that has none, then writes them all in full.
 */
export async function syncCompanySheet(editionId: string, companyId: string): Promise<void> {
  if (!isGoogleConfigured()) throw new GoogleNotConnectedError();

  const db = createInterviewsClient();
  const edition = await loadEdition(db, editionId);
  if (!edition) return;
  const pairs = await loadPairs(db, editionId, new Set([companyId]));
  if (pairs.length === 0) throw new Error('This company has no room with a session yet.');

  const sheets = await savedSheets(db, editionId);
  const tabsByPair = await loadTabs(db, edition, pairs);
  for (const pair of pairs) {
    const sheet = await ensureSheet(db, edition, pair, sheets);
    await writeSheet(db, edition, pair, sheet.id, tabsByPair.get(sheetKey(pair.company.id, pair.room.id)) ?? []);
  }
}

/**
 * After a booking or stage change (sheetsSync.ts): for every company that
 * has opted in, creates the file of any room it was given since, and
 * rewrites each file whose rows changed. A deleted company's or room's file
 * is left as it last was.
 */
export async function refreshCompanySheets(editionId: string): Promise<PullResult> {
  let result = emptyResult();
  if (!isGoogleConfigured()) return result;

  const db = createInterviewsClient();
  const sheets = await savedSheets(db, editionId);
  if (Object.keys(sheets).length === 0) return result;
  const edition = await loadEdition(db, editionId);
  if (!edition) return result;

  const pairs = (await loadPairs(db, editionId)).filter((p) => optedIn(sheets, p.company.id));
  const tabsByPair = await loadTabs(db, edition, pairs);

  for (const pair of pairs) {
    const tabs = tabsByPair.get(sheetKey(pair.company.id, pair.room.id)) ?? [];
    try {
      const sheet = await ensureSheet(db, edition, pair, sheets);
      if (writtenAlready(`company:${sheet.id}`, tabs)) continue;
      result = addResults(result, await writeSheet(db, edition, pair, sheet.id, tabs));
    } catch (error) {
      // One file (deleted in Drive, say) must not stop the others.
      console.error(`[interviews/companySheets] ${pair.company.name_en} / ${pair.room.name} failed`, error);
    }
  }
  return result;
}

/**
 * The every-minute pull (sheetsSync.ts): applies the Status edits waiting in
 * each company file that `changed` says moved since it was last read, and
 * marks it `read` once applied. A file
 * where something differed from the app but could not be applied is
 * forgotten by the unchanged-sheet memory, so the next sync rewrites it and
 * the sheet shows the app's value again.
 */
export async function pullCompanySheets(
  editionId: string,
  changed: (spreadsheetId: string) => boolean,
  read: (spreadsheetId: string) => void,
): Promise<PullResult> {
  let result = emptyResult();
  if (!isGoogleConfigured()) return result;

  const db = createInterviewsClient();
  const sheets = await savedSheets(db, editionId);
  if (Object.keys(sheets).length === 0) return result;
  const pairs = await loadPairs(db, editionId);

  for (const pair of pairs) {
    const sheet = sheets[sheetKey(pair.company.id, pair.room.id)];
    if (!sheet || !changed(sheet.id)) continue;
    try {
      const pulled = await pullPair(pair, sheet.id);
      if (pulled.conflicts || pulled.ignored) forgetWritten(`company:${sheet.id}`);
      result = addResults(result, pulled);
      read(sheet.id);
    } catch (error) {
      console.error(`[interviews/companySheets] pull ${pair.company.name_en} / ${pair.room.name} failed`, error);
    }
  }
  return result;
}

/** Every company file the edition has, for the pull's changed-since check. */
export async function companySheetIds(editionId: string): Promise<string[]> {
  const db = createInterviewsClient();
  return Object.values(await savedSheets(db, editionId)).map((s) => s.id);
}

