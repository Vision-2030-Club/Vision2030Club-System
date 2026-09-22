import 'server-only';
import { getAccessToken } from './auth';

/**
 * A live mirror of one interview edition's floor: every booked slot, across
 * every room and day, kept as one Google Sheet — one tab per day — that the
 * club's Google account owns and shares by name. Nothing here reads FROM the sheet — see the
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

  const body = response.status === 204 ? null : await response.json().catch(() => null);
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

/** Reads back one tab's cells — for pulling Stage edits (floorSheet.ts). */
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
 * `sheetId`. A full rewrite rather than a patch: a day's row count and
 * layout change constantly (a cancelled booking, a room added), and
 * computing a minimal diff would cost more than just resending everything —
 * this is at most a few hundred cells.
 *
 * Old merges, background/text formatting and conditional-format rules are
 * all cleared first: `values.clear` touches none of them, so a row that
 * carried a coral or navy fill in a previous sync (a room block that has
 * since shrunk, a layout that gained a title row and shifted everything
 * down) would otherwise keep that colour forever, bleeding into whatever
 * the new sync puts there. Re-adding a Stage colour rule on every sync
 * without clearing the last sync's copy would likewise just keep piling up
 * duplicates.
 *
 * `USER_ENTERED` rather than `RAW` so a `=HYPERLINK(...)` cell (the CV
 * column) actually evaluates instead of showing as literal formula text.
 */
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

  const oldFormatCount = await conditionalFormatCount(spreadsheetId, sheetId);
  await googleFetch(SHEETS_API, `/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        ...Array.from({ length: oldFormatCount }, () => ({ deleteConditionalFormatRule: { sheetId, index: 0 } })),
        { unmergeCells: { range: { sheetId } } },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 26 },
            cell: { userEnteredFormat: {} },
            fields: 'userEnteredFormat',
          },
        },
      ],
    }),
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
