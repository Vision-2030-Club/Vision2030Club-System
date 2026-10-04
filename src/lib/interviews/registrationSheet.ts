import 'server-only';
import { after } from 'next/server';
import { GoogleNotConnectedError, isGoogleConfigured } from '@/lib/google/auth';
import {
  appendRows,
  createSpreadsheet,
  forgetWritten,
  listTabs,
  rememberWritten,
  revokeLinkSharing,
  writeTab,
  writtenAlready,
} from '@/lib/google/sheets';
import { resolveApplyFields, type ApplyField } from '@/lib/interviews/applyFields';
import { siteUrl } from '@/lib/interviews/email';
import {
  columnVisibility,
  dayOf,
  englishLabel,
  headerRowFormat,
  levelLabel,
  pages,
  plain,
  stamp,
  timeOf,
  universityLabel,
  yesNo,
} from '@/lib/interviews/sheetFormat';
import type { Edition, EditionSettings } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';

/**
 * The registrations sheet: one Google Sheet per edition with a row for every
 * submission, from the public apply form and from staff on the Register tab.
 *
 * Columns: submitted, name, email, every answer the form can ask, the
 * companies in rank order, which of them accepted and rejected the student,
 * what the student booked, CV, a note, and the application id. The column of
 * a question the edition does not ask is hidden, unless some row has an
 * answer in it (the question was switched off after people answered it).
 *
 * Three ways in:
 *   - kickRegistrationAppend, after each submission: appends ONE row. Cheap,
 *     and what people watching the sheet expect to see. A re-submission with
 *     the same email appends another row marked "Updated"; the later row wins.
 *   - refreshRegistrationSheet, after an HR decision or a booking change
 *     (sheetsSync.ts): rewrites the whole tab, so Accepted, Rejected and
 *     Booked stay current, and skips Google entirely when nothing in the
 *     sheet would change.
 *   - syncRegistrationSheet, from Settings → "Sync now": the same rewrite,
 *     always, creating the sheet if there is none. The repair for a row that
 *     never arrived (Google was down, the account not connected yet).
 *
 * The database is the record; this is a copy for people who live in Sheets.
 * Nothing is read back from it.
 *
 * Like the floor sheet it holds names, emails, phones and CV links, so it is
 * shared with nobody: open it from the club's Google account and share it by
 * name. Link sharing is switched off on every rebuild. The CV column links to
 * /api/interviews/cv, which asks for a signed-in HR person or manager, so the
 * link never expires and never works for someone the sheet was forwarded to.
 */

const TAB = 'Registrations';

/** Each column, and the form question it answers (hidden when the edition does not ask it). */
const COLUMNS: { title: string; field?: ApplyField }[] = [
  { title: 'Submitted' },
  { title: 'Name' },
  { title: 'Email' },
  { title: 'Phone', field: 'phone' },
  { title: 'University', field: 'university' },
  { title: 'Year', field: 'level' },
  { title: 'College', field: 'college' },
  { title: 'Major', field: 'major' },
  { title: 'GPA', field: 'gpa' },
  { title: 'English', field: 'english_level' },
  { title: 'Club member', field: 'is_club_member' },
  { title: 'Why first choice', field: 'why_first' },
  { title: 'Companies' },
  { title: 'Accepted' },
  { title: 'Rejected' },
  { title: 'Booked' },
  { title: 'CV' },
  { title: 'Note' },
  { title: 'Application ID' },
];

const ROW_FIELDS =
  'id, name, email, phone, university, university_other, level, college, major, gpa, english_level, is_club_member, why_first, submitted_at, cv_path';

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  university: string | null;
  university_other: string | null;
  level: string | null;
  college: string | null;
  major: string | null;
  gpa: string | null;
  english_level: string | null;
  is_club_member: boolean | null;
  why_first: string | null;
  submitted_at: string;
  cv_path: string | null;
};

type Preference = { application_id: string; company_id: string; rank: number; decision: string };
type BookingRow = { application_id: string; company_id: string; starts_at: string };

/** What one application's row says about companies: its choices, HR's decisions, its bookings. */
type Choices = { companies: string[]; accepted: string[]; rejected: string[]; booked: string[] };

function emptyChoices(): Choices {
  return { companies: [], accepted: [], rejected: [], booked: [] };
}

function choicesByApplication(
  preferences: Preference[],
  bookings: BookingRow[],
  names: Map<string, string>,
  zone: string,
): Map<string, Choices> {
  const out = new Map<string, Choices>();
  const of = (id: string) => {
    const held = out.get(id);
    if (held) return held;
    const fresh = emptyChoices();
    out.set(id, fresh);
    return fresh;
  };
  for (const p of [...preferences].sort((a, b) => a.rank - b.rank)) {
    const name = names.get(p.company_id) ?? '';
    const c = of(p.application_id);
    c.companies.push(name);
    if (p.decision === 'accepted') c.accepted.push(name);
    if (p.decision === 'rejected') c.rejected.push(name);
  }
  for (const b of [...bookings].sort((x, y) => x.starts_at.localeCompare(y.starts_at))) {
    of(b.application_id).booked.push(
      `${names.get(b.company_id) ?? ''} at ${dayOf(b.starts_at, zone)} ${timeOf(b.starts_at, zone)}`,
    );
  }
  return out;
}

function answerCell(application: Row, field: ApplyField): string {
  switch (field) {
    case 'phone':
      return plain(application.phone);
    case 'university':
      return plain(universityLabel(application));
    case 'level':
      return levelLabel(application.level);
    case 'college':
      return plain(application.college);
    case 'major':
      return plain(application.major);
    case 'gpa':
      return plain(application.gpa);
    case 'english_level':
      return englishLabel(application.english_level);
    case 'is_club_member':
      return yesNo(application.is_club_member);
    case 'why_first':
      return plain(application.why_first);
  }
}

function toRow(edition: Edition, application: Row, choices: Choices, note: string): string[] {
  const cv =
    application.cv_path && edition.club_project_id
      ? `=HYPERLINK("${siteUrl()}/api/interviews/cv?project=${edition.club_project_id}&application=${application.id}", "View CV")`
      : '';
  const cells: Record<string, string> = {
    Submitted: stamp(application.submitted_at, edition.time_zone),
    Name: plain(application.name),
    Email: plain(application.email),
    Companies: plain(choices.companies.join(' · ')),
    Accepted: plain(choices.accepted.join(' · ')),
    Rejected: plain(choices.rejected.join(' · ')),
    Booked: plain(choices.booked.join(' · ')),
    CV: cv,
    Note: note,
    'Application ID': application.id,
  };
  return COLUMNS.map((column) => (column.field ? answerCell(application, column.field) : (cells[column.title] ?? '')));
}

type Db = ReturnType<typeof createInterviewsClient>;

async function companyNames(db: Db, editionId: string): Promise<Map<string, string>> {
  const { data } = await db.from('companies').select('id, name_en').eq('edition_id', editionId);
  return new Map(((data ?? []) as { id: string; name_en: string }[]).map((c) => [c.id, c.name_en]));
}

async function loadEdition(db: Db, editionId: string): Promise<Edition | null> {
  const { data } = await db.from('editions').select('*').eq('id', editionId).maybeSingle();
  return data as Edition | null;
}

/**
 * The edition's sheet, remembered in its settings (`registrations_sheet_id`
 * and `_url`, merged in by update_edition like every other setting) rather
 * than in 0010's columns, so it works on a database that never got 0010.
 */
async function savedSheet(db: Db, editionId: string): Promise<string | null> {
  const { data } = await db.rpc('edition_settings', { p_edition: editionId });
  const id = (data as EditionSettings | null)?.registrations_sheet_id;
  return typeof id === 'string' && id ? id : null;
}

/** The edition's sheet, created and remembered the first time it is needed. */
async function ensureSheet(db: Db, edition: Edition): Promise<string> {
  const saved = await savedSheet(db, edition.id);
  if (saved) return saved;
  const { id, url } = await createSpreadsheet(`${edition.name_en} — Registrations`, TAB);
  const { error } = await db.rpc('update_edition', {
    p_edition: edition.id,
    p_patch: { settings: { registrations_sheet_id: id, registrations_sheet_url: url } },
    p_actor: { kind: 'system', name: 'Registrations sheet' },
  });
  if (error) throw new Error(error.message);
  return id;
}

/** The tab to write into: the one named TAB, or the first if someone renamed it. */
async function tabOf(spreadsheetId: string): Promise<{ sheetId: number; title: string }> {
  const tabs = await listTabs(spreadsheetId);
  const tab = tabs.find((t) => t.title === TAB) ?? tabs[0];
  if (!tab) throw new Error('The registrations sheet has no tab.');
  return tab;
}

const cacheKey = (spreadsheetId: string) => `registrations:${spreadsheetId}`;

/**
 * Rewrites the whole sheet from the database. `force` (Sync now) creates the
 * sheet if there is none and always writes; without it, an edition with no
 * sheet yet is left alone and an unchanged sheet is not touched.
 */
async function rebuild(editionId: string, force: boolean): Promise<void> {
  if (!isGoogleConfigured()) throw new GoogleNotConnectedError();

  const db = createInterviewsClient();
  const edition = await loadEdition(db, editionId);
  if (!edition) return;
  if (!force && !(await savedSheet(db, editionId))) return;

  const [applications, preferences, bookings, names, { data: settings }] = await Promise.all([
    pages<Row>((from, to) =>
      db
        .from('applications')
        .select(ROW_FIELDS)
        .eq('edition_id', editionId)
        .order('submitted_at')
        .order('id')
        .range(from, to),
    ),
    pages<Preference>((from, to) =>
      db
        .from('application_preferences')
        .select('application_id, company_id, rank, decision')
        .eq('edition_id', editionId)
        .order('application_id')
        .order('rank')
        .range(from, to),
    ),
    pages<BookingRow>((from, to) =>
      db
        .from('bookings')
        .select('application_id, company_id, starts_at')
        .eq('edition_id', editionId)
        .is('cancelled_at', null)
        .order('id')
        .range(from, to),
    ),
    companyNames(db, editionId),
    db.rpc('edition_settings', { p_edition: editionId }),
  ]);

  const choices = choicesByApplication(preferences, bookings, names, edition.time_zone);
  const rows = [
    COLUMNS.map((c) => c.title),
    ...applications.map((a) => toRow(edition, a, choices.get(a.id) ?? emptyChoices(), '')),
  ];

  const asked = resolveApplyFields((settings as EditionSettings | null)?.apply_fields);
  const hidden = COLUMNS.map(
    (column, i) => Boolean(column.field) && asked[column.field!] === 'off' && rows.slice(1).every((r) => !r[i]),
  );

  const spreadsheetId = await ensureSheet(db, edition);
  if (!force && writtenAlready(cacheKey(spreadsheetId), { rows, hidden })) return;

  await revokeLinkSharing(spreadsheetId);
  const tab = await tabOf(spreadsheetId);
  await writeTab(spreadsheetId, tab.sheetId, tab.title, rows, [
    ...headerRowFormat(tab.sheetId),
    ...columnVisibility(tab.sheetId, hidden),
  ]);
  rememberWritten(cacheKey(spreadsheetId), { rows, hidden });
}

/** Settings → Sync now: rewrites the whole sheet, creating it on first use. */
export async function syncRegistrationSheet(editionId: string): Promise<void> {
  await rebuild(editionId, true);
}

/** After a decision or a booking change (sheetsSync.ts): rewrites an existing sheet if anything in it changed. */
export async function refreshRegistrationSheet(editionId: string): Promise<void> {
  await rebuild(editionId, false);
}

/**
 * Appends one submission. With no sheet yet, the first submission builds it
 * whole instead (which includes this row). Two instances doing that in the
 * same second could each create a sheet; the edition keeps the later one,
 * and Sync now makes it complete.
 */
async function appendRegistration(editionId: string, applicationId: string, replaced: boolean): Promise<void> {
  if (!isGoogleConfigured()) return;

  const db = createInterviewsClient();
  const edition = await loadEdition(db, editionId);
  if (!edition) return;
  const sheetId = await savedSheet(db, editionId);
  if (!sheetId) {
    await syncRegistrationSheet(editionId);
    return;
  }

  const [{ data: application }, { data: preferences }, { data: bookings }, names] = await Promise.all([
    db.from('applications').select(ROW_FIELDS).eq('id', applicationId).maybeSingle(),
    db
      .from('application_preferences')
      .select('application_id, company_id, rank, decision')
      .eq('application_id', applicationId),
    db
      .from('bookings')
      .select('application_id, company_id, starts_at')
      .eq('application_id', applicationId)
      .is('cancelled_at', null),
    companyNames(db, editionId),
  ]);
  if (!application) return;

  const choices =
    choicesByApplication(
      (preferences ?? []) as Preference[],
      (bookings ?? []) as BookingRow[],
      names,
      edition.time_zone,
    ).get(applicationId) ?? emptyChoices();
  const tab = await tabOf(sheetId);
  await appendRows(sheetId, tab.title, [toRow(edition, application as Row, choices, replaced ? 'Updated' : '')]);
  // The sheet no longer matches the last rewrite, so the next refresh must write.
  forgetWritten(cacheKey(sheetId));
}

/**
 * Fire-and-forget, after the response has gone out, like kickSheetsSync:
 * Google being down or not connected must never fail the submission.
 */
export function kickRegistrationAppend(editionId: string, applicationId: string, replaced: boolean): void {
  after(async () => {
    try {
      await appendRegistration(editionId, applicationId, replaced);
    } catch (error) {
      if (error instanceof GoogleNotConnectedError) return;
      console.error('[interviews/registrationSheet] append failed', error);
    }
  });
}
