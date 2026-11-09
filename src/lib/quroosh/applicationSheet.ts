import 'server-only';
import { after } from 'next/server';
import { GoogleNotConnectedError, isGoogleConfigured } from '@/lib/google/auth';
import {
  appendRows,
  createSpreadsheet,
  ensureColumns,
  listTabs,
  revokeLinkSharing,
  spreadsheetUsable,
  writeTab,
} from '@/lib/google/sheets';
import { headerRowFormat, pages, plain, stamp, yesNo } from '@/lib/interviews/sheetFormat';
import { QUESTIONS, type Question } from '@/lib/quroosh/questions';
import type { QurooshApplication, QurooshApplicationMember } from '@/lib/quroosh/types';
import { createQurooshClient } from '@/lib/supabase/quroosh';
import { CLUB_TIME_ZONE } from '@/lib/time';
import en from '../../../messages/en.json';

/**
 * The applications sheet: one Google Sheet per club project running
 * Quroosh, with a row for every application from the public form. Modelled
 * on Mock Interviews' registrations sheet (lib/interviews/registrationSheet.ts).
 *
 * Columns: submitted, then every question in the form's own order
 * (QUESTIONS, so a question added there gets its column here with no other
 * change), the other team members under "Are other people working…", and
 * the application id. Headers and choices are the English form's labels.
 *
 * Two ways in:
 *   - kickApplicationAppend, after each submission: appends ONE row. With no
 *     sheet yet (or one deleted in Drive), builds the whole sheet instead.
 *   - syncApplicationSheet, from the Applications page's "Sync now":
 *     rewrites the whole sheet from the database, creating it if there is
 *     none. The repair for a row that never arrived (Google was down, the
 *     account not connected yet).
 *
 * The sheet is made in the Google account connected under Admin → Google
 * (the `drive.file` scope only lets the app write files it made itself), and
 * remembered in the Quroosh database's settings (0003). It holds founders'
 * names, phones, emails and ages, so it is shared with nobody: link sharing
 * is switched off on every rebuild, and the account's owner shares it with
 * named people.
 *
 * The database is the record; nothing is read back from the sheet.
 */

const TAB = 'Applications';
const DEFAULT_TITLE = 'Quroosh — Applications';

const QUESTION_LABELS: Record<string, string> = en.quroosh.apply.q;
const OPTION_LABELS = en.quroosh.apply.options as Record<string, Record<string, string>>;

type Row = QurooshApplication;

/** Every question's own column, with the other team members right after "has_team". */
const TITLES: string[] = [
  'Submitted',
  ...QUESTIONS.flatMap((q) => {
    const title = QUESTION_LABELS[q.name] ?? q.name;
    return q.name === 'has_team' ? [title, 'Team members'] : [title];
  }),
  'Application ID',
];

function optionLabel(question: Question, value: string): string {
  return OPTION_LABELS[question.name]?.[value] ?? value;
}

function answerCell(question: Question, row: Row): string {
  const value = row[question.name];
  if (value === null || value === undefined || value === '') return '';
  switch (question.kind) {
    case 'yesno':
    case 'consent':
      return yesNo(Boolean(value));
    case 'radio':
    case 'select':
      return plain(optionLabel(question, String(value)));
    case 'checkboxes':
      return Array.isArray(value) ? plain(value.map((v) => optionLabel(question, String(v))).join(' · ')) : '';
    default:
      // Text as typed: the apostrophe keeps "+966…" and a leading "=" as text.
      return plain(String(value));
  }
}

function membersCell(members: QurooshApplicationMember[] | undefined): string {
  if (!members?.length) return '';
  return plain(
    [...members]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => `${m.name} · ${m.phone} · ${m.email}`)
      .join('\n'),
  );
}

function toRow(row: Row): string[] {
  const cells = [stamp(row.created_at, CLUB_TIME_ZONE)];
  for (const question of QUESTIONS) {
    cells.push(answerCell(question, row));
    if (question.name === 'has_team') cells.push(membersCell(row.application_members));
  }
  cells.push(row.id);
  return cells;
}

const SELECT = '*, application_members(name, phone, email, sort_order)';

type Db = ReturnType<typeof createQurooshClient>;

/**
 * The project's saved sheet, or null when it has none yet. Before 0003 is
 * applied the column does not exist: that throws, so no sheet is ever made
 * that could not be remembered (every application would make another).
 */
async function savedSheet(db: Db, projectId: string): Promise<string | null> {
  const { data, error } = await db.from('settings').select('sheet_id').eq('project_id', projectId).maybeSingle();
  if (error) throw new Error(`The applications sheet needs Quroosh migration 0003: ${error.message}`);
  const id = (data as { sheet_id: string | null } | null)?.sheet_id;
  return id || null;
}

/** The project's sheet, created and remembered the first time it is needed, and again if it was deleted in Drive. */
async function ensureSheet(db: Db, projectId: string, title: string): Promise<string> {
  const saved = await savedSheet(db, projectId);
  if (saved && (await spreadsheetUsable(saved))) return saved;
  const { id, url } = await createSpreadsheet(title, TAB);
  const { error } = await db.rpc('save_sheet', { p_project: projectId, p_sheet_id: id, p_sheet_url: url });
  if (error) throw new Error(error.message);
  return id;
}

/** The tab to write into: the one named TAB, or the first if someone renamed it. */
async function tabOf(spreadsheetId: string): Promise<{ sheetId: number; title: string }> {
  const tabs = await listTabs(spreadsheetId);
  const tab = tabs.find((t) => t.title === TAB) ?? tabs[0];
  if (!tab) throw new Error('The applications sheet has no tab.');
  return tab;
}

/**
 * Sync now: rewrites the whole sheet from the database, oldest application
 * first, creating the sheet if there is none. `title` names a new sheet
 * (the project's name, when a manager presses the button).
 */
export async function syncApplicationSheet(projectId: string, title: string = DEFAULT_TITLE): Promise<void> {
  if (!isGoogleConfigured()) throw new GoogleNotConnectedError();

  const db = createQurooshClient();
  const applications = await pages<Row>((from, to) =>
    db
      .from('applications')
      .select(SELECT)
      .eq('project_id', projectId)
      .order('created_at')
      .order('id')
      .range(from, to),
  );
  const rows = [TITLES, ...applications.map(toRow)];

  const spreadsheetId = await ensureSheet(db, projectId, title);
  await revokeLinkSharing(spreadsheetId);
  const tab = await tabOf(spreadsheetId);
  await ensureColumns(spreadsheetId, tab.sheetId, TITLES.length);
  await writeTab(spreadsheetId, tab.sheetId, tab.title, rows, headerRowFormat(tab.sheetId));
}

/**
 * Appends one application. With no sheet yet, the first application builds
 * it whole instead (which includes this row). Two applications in the same
 * second could each make a sheet; the project keeps the later one, and Sync
 * now makes it complete.
 */
async function appendApplication(projectId: string, applicationId: string): Promise<void> {
  if (!isGoogleConfigured()) return;

  const db = createQurooshClient();
  const sheetId = await savedSheet(db, projectId);
  if (!sheetId || !(await spreadsheetUsable(sheetId))) {
    await syncApplicationSheet(projectId);
    return;
  }

  const { data } = await db.from('applications').select(SELECT).eq('id', applicationId).maybeSingle();
  if (!data) return;
  const tab = await tabOf(sheetId);
  await appendRows(sheetId, tab.title, [toRow(data as Row)]);
}

/**
 * Fire-and-forget, after the founder has been answered: Google being down or
 * not connected must never fail an application.
 */
export function kickApplicationAppend(projectId: string, applicationId: string): void {
  after(async () => {
    try {
      await appendApplication(projectId, applicationId);
    } catch (error) {
      if (error instanceof GoogleNotConnectedError) return;
      console.error('[quroosh/applicationSheet] append failed', error);
    }
  });
}
