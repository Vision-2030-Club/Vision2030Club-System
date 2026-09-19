import 'server-only';
import { getAccessToken } from './auth';

/**
 * A live, read-only mirror of one interview edition's floor: every booked
 * slot, across every room and day, kept as one Google Sheet a link can be
 * shared to. Nothing here reads FROM the sheet — see the design note in
 * lib/interviews/floorSheet.ts for why this is one-way.
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

/**
 * Replaces the sheet's whole content with `rows`. A full rewrite rather than
 * a patch: the floor's row count and order change constantly (a cancelled
 * booking, a moved one, a room added), and computing a minimal diff would
 * cost more than just resending everything — this is at most a few hundred
 * cells.
 *
 * `boldRows` (0-based) are bolded afterwards — the room and column headers
 * that mark each block. `USER_ENTERED` rather than `RAW` so a
 * `=HYPERLINK(...)` cell (the CV column) actually evaluates instead of
 * showing as literal formula text.
 */
export async function writeFloorSheet(
  spreadsheetId: string,
  rows: string[][],
  boldRows: number[] = [],
): Promise<void> {
  const range = 'A1:Z10000';
  await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}/values/${range}:clear`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  await googleFetch(
    SHEETS_API,
    `/spreadsheets/${spreadsheetId}/values/A1?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ values: rows }) },
  );

  if (boldRows.length === 0) return;

  // The default sheet of a spreadsheet just created by spreadsheets.create
  // always has sheetId 0 — nothing here ever creates a second sheet.
  await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: boldRows.map((row) => ({
        repeatCell: {
          range: { sheetId: 0, startRowIndex: row, endRowIndex: row + 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: 'userEnteredFormat.textFormat.bold',
        },
      })),
    }),
  });
}
