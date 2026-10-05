import 'server-only';
import { GoogleNotConnectedError, isGoogleConfigured } from '@/lib/google/auth';
import {
  createSpreadsheet,
  deleteOtherTabs,
  ensureNamedTab,
  listTabs,
  readTab,
  rememberWritten,
  revokeLinkSharing,
  writeTab,
  writtenAlready,
} from '@/lib/google/sheets';
import { siteUrl } from '@/lib/interviews/email';
import { loadCompanies, loadRooms } from '@/lib/interviews/queries';
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
import type { Company, Edition, EditionSettings, SlotStatus, Stage } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';

/**
 * A Google Sheet per company, drawn after the club's "Company Template —
 * 5th edition": one tab per day the company interviews, named by its date
 * ("10/12") like the floor sheet's tabs.
 *
 * Each tab: the edition's name on a teal banner, a lime stripe, the
 * COMPANY / DATE / ROOM labels with their values, then one row per slot of
 * the company's session that day, booked or not — Time, Interviewer,
 * Student Name, Phone Number, Student CV, Feedback Link, Status.
 *
 * Created only when a manager presses "Create Google Sheet" on that
 * company's card on the Rooms tab, and owned by the club's Google account
 * like the other sheets. Nothing shares it automatically: HR opens it from
 * that account and shares it with the company's people by name. Link
 * sharing is switched off on every rebuild. It carries students' phone
 * numbers, by the club's decision of 2026-10-05, as the template does.
 *
 * Who writes what:
 *   - Status is the system's: the floor's stage as the template's words
 *     (Interview Done, No Show, In-progress), blank before that. Anything
 *     typed there is overwritten by the next sync, and nothing is read back.
 *   - Interviewer is the company's: the system has no such data, so it
 *     reads the column before each rewrite and puts each name back on its
 *     time slot (keyed by the hidden eighth column, the slot id).
 *   - The CV link is the interviewer page's own (`/api/interviews/cv?token=…`):
 *     it opens only a CV of a student booked with THIS company, and only after
 *     the company's PIN, if it has one. The Feedback link opens the interviewer
 *     page on that student's day with their feedback form open. A new
 *     interviewer link (rotateCompanyTokenAction) changes both, and the next
 *     sync rewrites them.
 *
 * Rebuilt after every booking or stage change (sheetsSync.ts), skipping
 * Google entirely for a company whose rows did not change; "Sync now" on
 * the card always rewrites. Kept in the edition's settings as
 * `company_sheets` ({ company id: { id, url } }), so it needs no migration.
 */

const HEADERS = ['Time', 'Interviewer', 'Student Name', 'Phone Number', 'Student CV', 'Feedback Link', 'Status'];
const INTERVIEWER_COL = 1;
const STATUS_COL = 6;
const VISIBLE_COLS = 7;
const KEY_COL = 7;
const FIRST_SLOT_ROW = 6;

const STATUS_LABELS: Partial<Record<Stage, string>> = {
  done: 'Interview Done',
  no_show: 'No Show',
  in_interview: 'In-progress',
};
const STATUS_CHOICES = ['Interview Done', 'No Show', 'In-progress'];

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

/** One day of one company: what its tab says, before any hand-typed Interviewer is put back. */
type DayTab = { label: string; rows: string[][] };

/** The edition's company sheets, by company id, ignoring anything malformed. */
export function companySheets(settings: { company_sheets?: unknown } | null | undefined): Record<string, Saved> {
  const saved = settings?.company_sheets;
  if (!saved || typeof saved !== 'object') return {};
  return Object.fromEntries(
    Object.entries(saved as Record<string, unknown>).filter((entry): entry is [string, Saved] => {
      const v = entry[1] as Partial<Saved> | null;
      return Boolean(v && typeof v.id === 'string' && typeof v.url === 'string');
    }),
  );
}

async function savedSheets(db: Db, editionId: string): Promise<Record<string, Saved>> {
  const { data } = await db.rpc('edition_settings', { p_edition: editionId });
  return companySheets(data as EditionSettings | null);
}

/** Remembers one company's sheet, read fresh so two quick creations do not undo each other. */
async function saveSheet(db: Db, editionId: string, companyId: string, sheet: Saved): Promise<void> {
  const sheets = { ...(await savedSheets(db, editionId)), [companyId]: sheet };
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

/** Every company's day tabs, built from one read of the edition's floor. */
async function loadTabs(db: Db, edition: Edition, companies: Company[]): Promise<Map<string, DayTab[]>> {
  const companyIds = new Set(companies.map((c) => c.id));
  const [rooms, allSlots] = await Promise.all([
    loadRooms(db, edition.id),
    pages<SlotStatus>((from, to) =>
      db.from('slot_status').select('*').eq('edition_id', edition.id).order('starts_at').order('id').range(from, to),
    ),
  ]);
  const slots = allSlots.filter((s) => companyIds.has(s.company_id));

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

  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const zone = edition.time_zone;
  const banner = edition.name_ar || edition.name_en;
  const out = new Map<string, DayTab[]>();

  for (const company of companies) {
    const byDay = new Map<string, SlotStatus[]>();
    for (const slot of slots) {
      if (slot.company_id !== company.id) continue;
      const day = dayOf(slot.starts_at, zone);
      byDay.set(day, [...(byDay.get(day) ?? []), slot]);
    }

    const tabs: DayTab[] = [...byDay.keys()].sort().map((day) => {
      const daySlots = byDay.get(day)!;
      const roomNames = [...new Set(daySlots.map((s) => roomName.get(s.room_id) ?? ''))].filter(Boolean).join(' · ');
      const pad = (cells: string[]) => [...cells, ...Array(VISIBLE_COLS + 1 - cells.length).fill('')];
      const rows: string[][] = [
        pad([banner]),
        pad([]),
        pad([]),
        pad(['COMPANY  /  الشركة', '', '', 'DATE  /  التاريخ', '', 'ROOM  /  الغرفة']),
        pad([plain(company.name_en), '', '', longDate(day), '', plain(roomNames)]),
        pad(HEADERS),
      ];
      for (const slot of daySlots) {
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
          '',
          booking ? plain(slot.student_name) : '',
          booking ? plain(slot.student_phone) : '',
          cv,
          feedback,
          booking && slot.stage ? (STATUS_LABELS[slot.stage] ?? '') : '',
          `slot:${slot.id}`,
        ]);
      }
      return { label: tabLabel(day), rows };
    });
    out.set(company.id, tabs);
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

/** Writes every day tab of one company's spreadsheet, keeping what was typed under Interviewer. */
async function writeSheet(spreadsheetId: string, tabs: DayTab[]): Promise<void> {
  await revokeLinkSharing(spreadsheetId);
  const existing = await listTabs(spreadsheetId);
  const claimed = new Set<number>();
  const keep = new Set<number>();

  if (tabs.length === 0) {
    // Google keeps at least one tab; say why it is empty rather than leave an old day behind.
    const label = 'No interviews yet';
    const sheetId = await ensureNamedTab(spreadsheetId, existing, claimed, label);
    keep.add(sheetId);
    await writeTab(spreadsheetId, sheetId, label, [['No interviews are scheduled for this company yet.']]);
  }

  for (const tab of tabs) {
    const sheetId = await ensureNamedTab(spreadsheetId, existing, claimed, tab.label);
    keep.add(sheetId);
    const interviewers = keptValues(await readTab(spreadsheetId, tab.label), [0], KEY_COL, INTERVIEWER_COL);
    const rows = tab.rows.map((row, i) =>
      i >= FIRST_SLOT_ROW && interviewers.has(row[KEY_COL])
        ? row.map((cell, c) => (c === INTERVIEWER_COL ? interviewers.get(row[KEY_COL])! : cell))
        : row,
    );
    await writeTab(spreadsheetId, sheetId, tab.label, rows, tabFormatting(sheetId, tab.rows.length - FIRST_SLOT_ROW));
  }

  await deleteOtherTabs(spreadsheetId, keep);
  rememberWritten(`company:${spreadsheetId}`, tabs);
}

async function loadEdition(db: Db, editionId: string): Promise<Edition | null> {
  const { data } = await db.from('editions').select('*').eq('id', editionId).maybeSingle();
  return data as Edition | null;
}

/**
 * The Rooms tab's "Create Google Sheet" and "Sync now": creates the
 * company's sheet if it has none, then writes it in full.
 */
export async function syncCompanySheet(editionId: string, companyId: string): Promise<void> {
  if (!isGoogleConfigured()) throw new GoogleNotConnectedError();

  const db = createInterviewsClient();
  const edition = await loadEdition(db, editionId);
  if (!edition) return;
  const company = (await loadCompanies(db, editionId)).find((c) => c.id === companyId);
  if (!company) throw new Error('This company is not in the edition.');

  let sheet = (await savedSheets(db, editionId))[companyId];
  if (!sheet) {
    sheet = await createSpreadsheet(`${edition.name_en} — ${company.name_en}`, 'Schedule');
    await saveSheet(db, editionId, companyId, sheet);
  }

  const tabs = (await loadTabs(db, edition, [company])).get(companyId) ?? [];
  await writeSheet(sheet.id, tabs);
}

/**
 * After a booking or stage change (sheetsSync.ts): rewrites each existing
 * company sheet whose rows changed. Never creates one, and leaves a deleted
 * company's sheet as it last was.
 */
export async function refreshCompanySheets(editionId: string): Promise<void> {
  if (!isGoogleConfigured()) return;

  const db = createInterviewsClient();
  const sheets = await savedSheets(db, editionId);
  if (Object.keys(sheets).length === 0) return;
  const edition = await loadEdition(db, editionId);
  if (!edition) return;

  const companies = (await loadCompanies(db, editionId)).filter((c) => sheets[c.id] && !c.is_hidden);
  const tabsByCompany = await loadTabs(db, edition, companies);

  for (const company of companies) {
    const spreadsheetId = sheets[company.id].id;
    const tabs = tabsByCompany.get(company.id) ?? [];
    if (writtenAlready(`company:${spreadsheetId}`, tabs)) continue;
    try {
      await writeSheet(spreadsheetId, tabs);
    } catch (error) {
      // One company's sheet (deleted in Drive, say) must not stop the others.
      console.error(`[interviews/companySheets] ${company.name_en} failed`, error);
    }
  }
}
