import 'server-only';
import { GoogleNotConnectedError, isGoogleConfigured } from '@/lib/google/auth';
import {
  createSpreadsheet,
  listTabs,
  rememberWritten,
  revokeLinkSharing,
  writeTab,
  writtenAlready,
} from '@/lib/google/sheets';
import { siteUrl } from '@/lib/interviews/email';
import { loadCompanies, loadRooms } from '@/lib/interviews/queries';
import {
  dayOf,
  headerRowFormat,
  levelLabel,
  pages,
  plain,
  STAGE_NAMES,
  timeOf,
  universityLabel,
} from '@/lib/interviews/sheetFormat';
import type { Company, Edition, EditionSettings, SlotStatus } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';

/**
 * A Google Sheet per company: its own interview schedule and nothing else,
 * for a company that would rather follow its day in Sheets than on its
 * interviewer page.
 *
 * Created only when a manager presses "Create Google Sheet" on that
 * company's card on the Rooms tab, and owned by the club's Google account
 * like the other two sheets. Nothing shares it automatically: HR opens it
 * from that account and shares it with the company's people by name. Link
 * sharing is switched off on every rebuild.
 *
 * What the company sees is what its interviewer page already shows it:
 * day, time, room, the student's name, university, year and major, a CV
 * link and the stage. Never a phone number or an email. The CV link is the
 * interviewer page's own (`/api/interviews/cv?token=…&booking=…`): it opens
 * only a CV of a student booked with THIS company, and only in a browser
 * that has passed the company's PIN, if it has one. A new interviewer link
 * (rotateCompanyTokenAction) changes every CV link, and the next sync
 * rewrites them.
 *
 * Rebuilt after every booking or stage change (sheetsSync.ts), skipping
 * Google entirely for a company whose rows did not change; "Sync now" on
 * the card always rewrites. Kept in the edition's settings as
 * `company_sheets` ({ company id: { id, url } }), so it needs no migration.
 */

const TAB = 'Schedule';
const COLUMNS = ['Day', 'Time', 'Room', 'Student', 'University', 'Year', 'Major', 'CV', 'Status'];

type Db = ReturnType<typeof createInterviewsClient>;
type Saved = { id: string; url: string };

type Student = {
  id: string;
  university: string | null;
  university_other: string | null;
  level: string | null;
  major: string | null;
  cv_path: string | null;
  cv_external_url: string | null;
};

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

/** Every company's rows, built from one read of the edition's floor. */
async function loadRows(db: Db, edition: Edition, companies: Company[]): Promise<Map<string, string[][]>> {
  const [rooms, slots] = await Promise.all([
    loadRooms(db, edition.id),
    pages<SlotStatus>((from, to) =>
      db
        .from('slot_status')
        .select('*')
        .eq('edition_id', edition.id)
        .not('booking_id', 'is', null)
        .order('starts_at')
        .order('id')
        .range(from, to),
    ),
  ]);

  const applicationIds = [...new Set(slots.map((s) => s.application_id).filter((v): v is string => Boolean(v)))];
  const students: Student[] = [];
  for (let i = 0; i < applicationIds.length; i += 200) {
    const { data } = await db
      .from('applications')
      .select('id, university, university_other, level, major, cv_path, cv_external_url')
      .in('id', applicationIds.slice(i, i + 200));
    students.push(...((data ?? []) as Student[]));
  }
  const studentById = new Map(students.map((s) => [s.id, s]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const zone = edition.time_zone;

  const out = new Map<string, string[][]>(companies.map((c) => [c.id, [COLUMNS]]));
  for (const slot of slots) {
    const company = companyById.get(slot.company_id);
    const rows = out.get(slot.company_id);
    if (!company || !rows || !slot.booking_id) continue;
    const student = slot.application_id ? studentById.get(slot.application_id) : undefined;
    const cv = student?.cv_path
      ? `=HYPERLINK("${siteUrl()}/api/interviews/cv?token=${company.access_token}&booking=${slot.booking_id}", "View CV")`
      : student?.cv_external_url
        ? `=HYPERLINK("${student.cv_external_url.replace(/"/g, '""')}", "View CV")`
        : '';
    rows.push([
      dayOf(slot.starts_at, zone),
      timeOf(slot.starts_at, zone),
      plain(roomName.get(slot.room_id)),
      plain(slot.student_name),
      plain(student ? universityLabel(student) : null),
      levelLabel(student?.level ?? null),
      plain(student?.major),
      cv,
      slot.stage ? (STAGE_NAMES[slot.stage] ?? slot.stage) : '',
    ]);
  }
  return out;
}

async function writeSheet(spreadsheetId: string, rows: string[][]): Promise<void> {
  await revokeLinkSharing(spreadsheetId);
  const tabs = await listTabs(spreadsheetId);
  const tab = tabs.find((t) => t.title === TAB) ?? tabs[0];
  if (!tab) throw new Error('The company sheet has no tab.');
  await writeTab(spreadsheetId, tab.sheetId, tab.title, rows, headerRowFormat(tab.sheetId));
  rememberWritten(`company:${spreadsheetId}`, rows);
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
    sheet = await createSpreadsheet(`${edition.name_en} — ${company.name_en}`, TAB);
    await saveSheet(db, editionId, companyId, sheet);
  }

  const rows = (await loadRows(db, edition, [company])).get(companyId) ?? [COLUMNS];
  await writeSheet(sheet.id, rows);
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
  const rowsByCompany = await loadRows(db, edition, companies);

  for (const company of companies) {
    const spreadsheetId = sheets[company.id].id;
    const rows = rowsByCompany.get(company.id) ?? [COLUMNS];
    if (writtenAlready(`company:${spreadsheetId}`, rows)) continue;
    try {
      await writeSheet(spreadsheetId, rows);
    } catch (error) {
      // One company's sheet (deleted in Drive, say) must not stop the others.
      console.error(`[interviews/companySheets] ${company.name_en} failed`, error);
    }
  }
}
