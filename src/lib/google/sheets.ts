import 'server-only';
import { createHash } from 'node:crypto';
import { getAccessToken } from './auth';

/**
 * A live mirror of one interview edition's floor: every booked slot, across
 * every room and day, kept as one Google Sheet — one tab per day — that the
 * club's Google account owns and shares by name. Nothing here reads FROM the sheet — see the
 * design note in lib/interviews/floorSheet.ts for why this is one-way.
 */

const SHEETS_API = 'https://sheets.googleapis.com/v4';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/**
 * How long to wait before each retry when Google says "too many requests"
 * (429: the club account's per-minute quota, about sixty writes and sixty
 * reads a minute). Sheets refills the quota every minute, so the waits add up
 * to just over one. Only a sync waits: the Sync now buttons do too, and say
 * Google's error if the minute still is not enough.
 */
const RETRY_WAITS_MS = [5_000, 20_000, 40_000];

/** Google refused a request; `status` is the HTTP status (404: no such file for this account). */
export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function googleFetch(base: string, path: string, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken();
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.status === 429 && attempt < RETRY_WAITS_MS.length) {
      const after = Number(response.headers.get('retry-after'));
      await new Promise((resolve) => setTimeout(resolve, after > 0 ? after * 1000 : RETRY_WAITS_MS[attempt]));
      continue;
    }
    if (!response.ok) {
      const message = body?.error?.message ?? `Google returned ${response.status}`;
      throw new GoogleApiError(message, response.status);
    }
    return body;
  }
}

/** A range's sheet name, quoted the way the Sheets API needs it (spaces, etc). */
function quoted(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/**
 * Creates a new spreadsheet. It belongs to the club's connected Google
 * account and is shared with NOBODY else by default: the sheet holds every
 * candidate's name, phone number and a link to their CV, so who may open it
 * is a decision an organizer makes by name in Google's own Share dialog,
 * not something a URL grants to whoever forwards it.
 */
export async function createFloorSheet(title: string): Promise<{ id: string; url: string }> {
  const created = await googleFetch(SHEETS_API, '/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({ properties: { title } }),
  });
  const id = created.spreadsheetId as string;
  return { id, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
}

/**
 * Like createFloorSheet, with the first tab named up front — Google names it
 * after the account's language otherwise ("Sheet1", "ورقة1"), and an append
 * has to address the tab by name.
 */
export async function createSpreadsheet(title: string, tabTitle: string): Promise<{ id: string; url: string }> {
  const created = await googleFetch(SHEETS_API, '/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: tabTitle } }] }),
  });
  const id = created.spreadsheetId as string;
  return { id, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
}

/**
 * Whether a spreadsheet the app saved earlier can still be written. Someone
 * signed in to the club's Google account can delete one in Drive, and the
 * app would otherwise keep writing to the missing file forever, every sync
 * failing and no new file ever made. A file in the trash is taken back out
 * (same link, sharing and Notes); one deleted for good, or not visible to the
 * connected account (404), is reported gone (false) so the caller makes a
 * new one. Any other error is thrown: Google being down or busy must never
 * replace a file.
 */
export async function spreadsheetUsable(spreadsheetId: string): Promise<boolean> {
  const path = `/files/${encodeURIComponent(spreadsheetId)}`;
  try {
    const file = await googleFetch(DRIVE_API, `${path}?fields=trashed`);
    if (!file?.trashed) return true;
    await googleFetch(DRIVE_API, path, { method: 'PATCH', body: JSON.stringify({ trashed: false }) });
    console.warn(`[google/sheets] ${spreadsheetId} was in the trash; restored it`);
    return true;
  } catch (error) {
    // Only a 404 means gone. Drive also answers 403 for rate limits, and
    // taking that for a deleted file would leave a duplicate behind.
    if (error instanceof GoogleApiError && error.status === 404) {
      console.warn(`[google/sheets] ${spreadsheetId} is gone (${error.status}); a new file will be made`);
      return false;
    }
    throw error;
  }
}

/**
 * Removes any "anyone with the link" permission from a sheet. Sheets created
 * before this rule were shared that way; every sync calls this, so an old
 * sheet is closed the first time the floor changes after the deploy, and a
 * permission someone adds by hand later is undone the same way. Named
 * people and groups are left alone.
 */
export async function revokeLinkSharing(spreadsheetId: string): Promise<void> {
  const data = await googleFetch(
    DRIVE_API,
    `/files/${encodeURIComponent(spreadsheetId)}/permissions?fields=permissions(id,type)`,
  );
  const open = ((data.permissions ?? []) as { id: string; type: string }[]).filter(
    (p) => p.type === 'anyone' || p.type === 'domain',
  );
  for (const permission of open) {
    await googleFetch(
      DRIVE_API,
      `/files/${encodeURIComponent(spreadsheetId)}/permissions/${encodeURIComponent(permission.id)}`,
      { method: 'DELETE' },
    );
  }
}

export type SheetTab = { sheetId: number; title: string };

export async function listTabs(spreadsheetId: string): Promise<SheetTab[]> {
  const data = await googleFetch(
    SHEETS_API,
    `/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
  );
  return ((data.sheets ?? []) as { properties: { sheetId: number; title: string } }[]).map((s) => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
  }));
}

export async function renameTab(spreadsheetId: string, sheetId: number, title: string): Promise<void> {
  await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ updateSheetProperties: { properties: { sheetId, title }, fields: 'title' } }],
    }),
  });
}

export async function addTab(spreadsheetId: string, title: string): Promise<number> {
  const data = await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  return data.replies[0].addSheet.properties.sheetId as number;
}

/**
 * The tab named `label` (a day, "9/19"): reuses one already named that,
 * otherwise claims the spreadsheet's leftover default tab (its very first
 * sync), otherwise adds a fresh one. `claimed` tracks which existing tabs
 * this run has already spoken for, so two days never fight over the same
 * unclaimed default.
 */
export async function ensureNamedTab(
  spreadsheetId: string,
  tabs: SheetTab[],
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

/** Removes any tab not in `keepIds` — a day whose sessions were deleted entirely. */
export async function deleteOtherTabs(spreadsheetId: string, keepIds: Set<number>): Promise<void> {
  const tabs = await listTabs(spreadsheetId);
  const toDelete = tabs.filter((t) => !keepIds.has(t.sheetId));
  // A spreadsheet needs at least one sheet; leaving one behind if everything
  // would otherwise be deleted is Google's rule, not a choice made here.
  if (toDelete.length === 0 || toDelete.length === tabs.length) return;
  await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: toDelete.map((t) => ({ deleteSheet: { sheetId: t.sheetId } })) }),
  });
}

/**
 * Every tab's cells as shown, in ONE read request — what a sync reads
 * before it rewrites a file (the Status edits waiting there, and the Notes
 * and Interviewer names it must put back), and what the every-minute pull
 * reads. One request per file rather than one per tab, because reads share
 * the account's per-minute quota with everything else.
 */
export async function readAllTabs(spreadsheetId: string): Promise<Map<string, string[][]>> {
  const data = await googleFetch(
    SHEETS_API,
    `/spreadsheets/${spreadsheetId}?includeGridData=true&fields=${encodeURIComponent(
      'sheets(properties(title),data(rowData(values(formattedValue))))',
    )}`,
  );
  const out = new Map<string, string[][]>();
  for (const sheet of (data.sheets ?? []) as {
    properties: { title: string };
    data?: { rowData?: { values?: { formattedValue?: string }[] }[] }[];
  }[]) {
    const rows = (sheet.data?.[0]?.rowData ?? []).map((row) => (row.values ?? []).map((cell) => cell.formattedValue ?? ''));
    out.set(sheet.properties.title, rows);
  }
  return out;
}

/**
 * When each spreadsheet this app made was last changed, by anyone — from
 * Drive, whose quota is separate and far larger than Sheets'. The pull
 * (sheetPull.ts) reads only the files whose time moved. `drive.file` lists
 * exactly the files this app created.
 */
export async function modifiedTimes(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
      fields: 'nextPageToken, files(id, modifiedTime)',
      pageSize: '1000',
      ...(pageToken ? { pageToken } : {}),
    });
    const data = await googleFetch(DRIVE_API, `/files?${params.toString()}`);
    for (const f of (data.files ?? []) as { id: string; modifiedTime: string }[]) out.set(f.id, f.modifiedTime);
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** Reads back one tab's cells. */
export async function readTab(spreadsheetId: string, sheetTitle: string): Promise<string[][]> {
  const range = `${quoted(sheetTitle)}!A1:Z10000`;
  const data = await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  return (data.values ?? []) as string[][];
}

/**
 * How many conditional-format rules a sheet already has — deleting by index
 * 0 that many times (in writeTab) clears them all, since each deletion
 * shifts the next rule into index 0.
 */
async function conditionalFormatCount(spreadsheetId: string, sheetId: number): Promise<number> {
  const data = await googleFetch(
    SHEETS_API,
    `/spreadsheets/${spreadsheetId}?fields=sheets(properties.sheetId,conditionalFormats)`,
  );
  const sheet = ((data.sheets ?? []) as { properties: { sheetId: number }; conditionalFormats?: unknown[] }[]).find(
    (s) => s.properties.sheetId === sheetId,
  );
  return sheet?.conditionalFormats?.length ?? 0;
}

/**
 * Replaces one tab's whole content with `rows`, then applies `formatRequests`
 * — raw Sheets API batchUpdate requests (repeatCell, mergeCells,
 * addConditionalFormatRule, …) the caller already built, addressed to
 * `sheetId` — all in one write request. A full rewrite rather than a patch:
 * a day's row count and layout change constantly (a cancelled booking, a
 * room added), and computing a minimal diff would cost more than resending
 * everything — this is at most a few hundred cells.
 *
 * Old values, merges, formatting, dropdowns, hidden columns and
 * conditional-format rules are all cleared first, inside the same request:
 * a row that carried a colour in a previous sync (a room block that has
 * since shrunk) would otherwise keep it forever, and re-adding a Status
 * colour rule on every sync without clearing the last one would pile up
 * duplicates.
 */
export async function writeTab(
  spreadsheetId: string,
  sheetId: number,
  sheetTitle: string,
  rows: string[][],
  formatRequests: object[] = [],
): Promise<void> {
  const oldFormatCount = await conditionalFormatCount(spreadsheetId, sheetId);
  // ONE write request for the whole tab: Google counts each request against
  // the account's ~60 writes a minute, and this used to take four.
  await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        ...Array.from({ length: oldFormatCount }, () => ({ deleteConditionalFormatRule: { sheetId, index: 0 } })),
        { unmergeCells: { range: { sheetId } } },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 26 },
            cell: {},
            fields: 'userEnteredValue,userEnteredFormat',
          },
        },
        // A dropdown with no rule clears it; a column hidden by an older
        // layout would otherwise hide whatever the new layout puts there.
        { setDataValidation: { range: { sheetId, startRowIndex: 0, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 26 } } },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 26 },
            properties: { hiddenByUser: false },
            fields: 'hiddenByUser',
          },
        },
        {
          updateCells: {
            start: { sheetId, rowIndex: 0, columnIndex: 0 },
            rows: rows.map((row) => ({ values: row.map(cellValue) })),
            fields: 'userEnteredValue',
          },
        },
        ...formatRequests,
      ],
    }),
  });
}

/**
 * One cell as the Sheets API stores it. A `=FORMULA(...)` (the CV and
 * feedback links) stays a formula; everything else is text exactly as given
 * — a leading apostrophe, which callers use to keep "05…" or "=name" as typed,
 * is the marker for that and is dropped. Text is never re-read as a number or
 * a date, so a time like "2:00 PM" stays the words the sheet was given.
 */
function cellValue(value: string): { userEnteredValue?: object } {
  if (!value) return {};
  if (value.startsWith('=')) return { userEnteredValue: { formulaValue: value } };
  return { userEnteredValue: { stringValue: value.startsWith("'") ? value.slice(1) : value } };
}

/**
 * What this server instance last wrote to each sheet, as a hash, so an
 * automatic sync can skip a sheet whose content has not changed. Every
 * booking change re-syncs every sheet of the edition, and the one Google
 * account they all share has a write quota of about sixty requests a
 * minute; most of those syncs change one company's sheet and leave the rest
 * as they were.
 *
 * Per instance and forgotten after ten minutes, so a sheet written by
 * another instance, or edited by hand, is at most ten minutes from being
 * rewritten. "Sync now" never consults it.
 */
const lastWritten = new Map<string, { hash: string; at: number }>();
const REMEMBER_MS = 10 * 60 * 1000;

function hashOf(content: unknown): string {
  return createHash('sha1').update(JSON.stringify(content)).digest('hex');
}

export function writtenAlready(key: string, content: unknown): boolean {
  const seen = lastWritten.get(key);
  return Boolean(seen && Date.now() - seen.at < REMEMBER_MS && seen.hash === hashOf(content));
}

export function rememberWritten(key: string, content: unknown): void {
  lastWritten.set(key, { hash: hashOf(content), at: Date.now() });
}

export function forgetWritten(key: string): void {
  lastWritten.delete(key);
}

/**
 * Adds rows under the last filled row of a tab. Google applies each append
 * on its own, so two submissions a second apart both land, one under the
 * other. `USER_ENTERED` for the same reason as writeTab (the CV hyperlink).
 */
export async function appendRows(spreadsheetId: string, sheetTitle: string, rows: string[][]): Promise<void> {
  const range = `${quoted(sheetTitle)}!A1`;
  await googleFetch(
    SHEETS_API,
    `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) },
  );
}
