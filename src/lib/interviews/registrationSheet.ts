import 'server-only';
import { after } from 'next/server';
import { GoogleNotConnectedError, isGoogleConfigured } from '@/lib/google/auth';
import { appendRows, createSpreadsheet, listTabs, revokeLinkSharing, writeTab } from '@/lib/google/sheets';
import { siteUrl } from '@/lib/interviews/email';
import type { Edition } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import en from '../../../messages/en.json';

/**
 * The registrations sheet: one Google Sheet per edition with a row for every
 * submission, from the public apply form and from staff on the Register tab.
 *
 * Columns: submitted, name, email, phone, university, year, major, the
 * companies in rank order, CV, a note, and the application id. A question the
 * edition does not ask (applyFields.ts) simply leaves its column blank.
 *
 * Two ways in:
 *   - kickRegistrationAppend, after each submission: appends ONE row. Cheap,
 *     and what people watching the sheet expect to see. A re-submission with
 *     the same email appends another row marked "Updated"; the later row wins.
 *   - syncRegistrationSheet, from Settings → "Rebuild": rewrites the whole tab
 *     from the database, one row per application. That is the repair for a
 *     row that never arrived (Google was down, the account not connected yet)
 *     and the way to fold the "Updated" duplicates away.
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
const COLUMNS = ['Submitted', 'Name', 'Email', 'Phone', 'University', 'Year', 'Major', 'Companies', 'CV', 'Note', 'Application ID'];
const ROW_FIELDS = 'id, name, email, phone, university, university_other, level, major, submitted_at, cv_path';

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  university: string | null;
  university_other: string | null;
  level: string | null;
  major: string | null;
  submitted_at: string;
  cv_path: string | null;
};

/** Answers stored as keys ("ksu", "year3") are written as the English form's own labels. */
const UNIVERSITY_LABELS: Record<string, string> = en.interviews.universities;
const LEVEL_LABELS: Record<string, string> = en.interviews.levels;

function university(application: Row): string | null {
  if (application.university === 'other') return application.university_other;
  return application.university ? (UNIVERSITY_LABELS[application.university] ?? application.university) : null;
}

/**
 * A leading apostrophe makes Sheets keep a value as typed: a name starting
 * with "=" stays a name rather than becoming a formula, and "05…" keeps its 0.
 */
function plain(value: string | null | undefined): string {
  return value ? `'${value}` : '';
}

function stamp(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function toRow(edition: Edition, application: Row, companies: string[], note: string): string[] {
  const cv =
    application.cv_path && edition.club_project_id
      ? `=HYPERLINK("${siteUrl()}/api/interviews/cv?project=${edition.club_project_id}&application=${application.id}", "View CV")`
      : '';
  return [
    stamp(application.submitted_at, edition.time_zone),
    plain(application.name),
    plain(application.email),
    plain(application.phone),
    plain(university(application)),
    application.level ? (LEVEL_LABELS[application.level] ?? application.level) : '',
    plain(application.major),
    plain(companies.join(' · ')),
    cv,
    note,
    application.id,
  ];
}

type Db = ReturnType<typeof createInterviewsClient>;

/** PostgREST answers at most 1000 rows a request; an edition has more preferences than that. */
async function pages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>): Promise<T[]> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data } = await fetchPage(from, from + size - 1);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < size) return rows;
  }
}

async function companyNames(db: Db, editionId: string): Promise<Map<string, string>> {
  const { data } = await db.from('companies').select('id, name_en').eq('edition_id', editionId);
  return new Map(((data ?? []) as { id: string; name_en: string }[]).map((c) => [c.id, c.name_en]));
}

async function loadEdition(db: Db, editionId: string): Promise<Edition | null> {
  const { data } = await db.from('editions').select('*').eq('id', editionId).maybeSingle();
  return data as Edition | null;
}

/** The edition's sheet, created (and remembered through 0010) the first time it is needed. */
async function ensureSheet(db: Db, edition: Edition): Promise<string> {
  if (edition.registrations_sheet_id) return edition.registrations_sheet_id;
  // Before 0010 there is nowhere to remember the sheet, and every press would
  // leave another orphan spreadsheet in the club's Drive.
  if (!('registrations_sheet_id' in edition)) {
    throw new Error('The registrations sheet needs interviews migration 0010 applied first.');
  }
  const { id, url } = await createSpreadsheet(`${edition.name_en} — Registrations`, TAB);
  const { error } = await db.rpc('set_registrations_sheet', {
    p_edition: edition.id,
    p_sheet_id: id,
    p_sheet_url: url,
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

/** Rewrites the whole sheet from the database. Creates it on first use. */
export async function syncRegistrationSheet(editionId: string): Promise<void> {
  if (!isGoogleConfigured()) throw new GoogleNotConnectedError();

  const db = createInterviewsClient();
  const edition = await loadEdition(db, editionId);
  if (!edition) return;

  const [applications, preferences, names] = await Promise.all([
    pages<Row>((from, to) =>
      db
        .from('applications')
        .select(ROW_FIELDS)
        .eq('edition_id', editionId)
        .order('submitted_at')
        .order('id')
        .range(from, to),
    ),
    pages<{ application_id: string; company_id: string; rank: number }>((from, to) =>
      db
        .from('application_preferences')
        .select('application_id, company_id, rank')
        .eq('edition_id', editionId)
        .order('application_id')
        .order('rank')
        .range(from, to),
    ),
    companyNames(db, editionId),
  ]);

  const choices = new Map<string, string[]>();
  for (const p of preferences) {
    const list = choices.get(p.application_id) ?? [];
    list.push(names.get(p.company_id) ?? '');
    choices.set(p.application_id, list);
  }

  const spreadsheetId = await ensureSheet(db, edition);
  await revokeLinkSharing(spreadsheetId);
  const tab = await tabOf(spreadsheetId);

  const rows = [COLUMNS, ...applications.map((a) => toRow(edition, a, choices.get(a.id) ?? [], ''))];
  await writeTab(spreadsheetId, tab.sheetId, tab.title, rows, [
    {
      repeatCell: {
        range: { sheetId: tab.sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId: tab.sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
  ]);
}

/**
 * Appends one submission. With no sheet yet, the first submission builds it
 * whole instead (which includes this row). Two instances doing that in the
 * same second could each create a sheet; the edition keeps the later one,
 * and Rebuild makes it complete.
 */
async function appendRegistration(editionId: string, applicationId: string, replaced: boolean): Promise<void> {
  if (!isGoogleConfigured()) return;

  const db = createInterviewsClient();
  const edition = await loadEdition(db, editionId);
  if (!edition) return;
  if (!edition.registrations_sheet_id) {
    await syncRegistrationSheet(editionId);
    return;
  }

  const [{ data: application }, { data: preferences }, names] = await Promise.all([
    db
      .from('applications')
      .select(ROW_FIELDS)
      .eq('id', applicationId)
      .maybeSingle(),
    db.from('application_preferences').select('company_id, rank').eq('application_id', applicationId).order('rank'),
    companyNames(db, editionId),
  ]);
  if (!application) return;

  const companies = ((preferences ?? []) as { company_id: string }[]).map((p) => names.get(p.company_id) ?? '');
  const tab = await tabOf(edition.registrations_sheet_id);
  await appendRows(edition.registrations_sheet_id, tab.title, [
    toRow(edition, application as Row, companies, replaced ? 'Updated' : ''),
  ]);
}

/**
 * Fire-and-forget, after the response has gone out, like kickFloorSheetSync:
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
