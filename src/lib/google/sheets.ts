import 'server-only';
import { getAccessToken } from './auth';

/**
 * A live, read-only mirror of one interview edition's floor: every booked
 * slot, across every room and day, kept as one Google Sheet a link can be
 * shared to — one tab per day. Nothing here reads FROM the sheet — see the
 * design note in lib/interviews/floorSheet.ts for why this is one-way.
 */

const SHEETS_API = 'https://sheets.googleapis.com/v4';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

async function googleFetch(base: string, path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `Google returned ${response.status}`;
    throw new Error(message);
  }
  return body;
}

/** A range's sheet name, quoted the way the Sheets API needs it (spaces, etc). */
function quoted(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/** Creates a new spreadsheet and makes it viewable by anyone with the link. */
export async function createFloorSheet(title: string): Promise<{ id: string; url: string }> {
  const created = await googleFetch(SHEETS_API, '/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({ properties: { title } }),
  });
  const id = created.spreadsheetId as string;

  // "Anyone with the link" rather than naming people: the sheet has no
  // write access either way (see below), and this is what makes sharing it
  // as simple as pasting the URL.
  await googleFetch(DRIVE_API, `/files/${encodeURIComponent(id)}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
  });

  return { id, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
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
 * Replaces one tab's whole content with `rows`, then applies `formatRequests`
 * — raw Sheets API batchUpdate requests (repeatCell, mergeCells, …) the
 * caller already built, addressed to `sheetId`. A full rewrite rather than a
 * patch: a day's row count and layout change constantly (a cancelled
 * booking, a room added), and computing a minimal diff would cost more than
 * just resending everything — this is at most a few hundred cells.
 *
 * Old merges are cleared first: `values.clear` does not touch merges left
 * over from a previous sync, and a merge from a wider layout can make a
 * narrower one silently fail to apply.
 *
 * `USER_ENTERED` rather than `RAW` so a `=HYPERLINK(...)` cell (the CV
 * column) actually evaluates instead of showing as literal formula text.
 */
/** Reads back one tab's cells — for pulling Stage edits (floorSheet.ts). */
export async function readTab(spreadsheetId: string, sheetTitle: string): Promise<string[][]> {
  const range = `${quoted(sheetTitle)}!A1:Z10000`;
  const data = await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  return (data.values ?? []) as string[][];
}

export async function writeTab(
  spreadsheetId: string,
  sheetId: number,
  sheetTitle: string,
  rows: string[][],
  formatRequests: object[] = [],
): Promise<void> {
  const range = `${quoted(sheetTitle)}!A1:Z10000`;
  await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ unmergeCells: { range: { sheetId } } }] }),
  });

  await googleFetch(
    SHEETS_API,
    `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${quoted(sheetTitle)}!A1`)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ values: rows }) },
  );

  if (formatRequests.length === 0) return;
  await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: formatRequests }),
  });
}
