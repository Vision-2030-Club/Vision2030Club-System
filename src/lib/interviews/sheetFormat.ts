import 'server-only';
import en from '../../../messages/en.json';

/**
 * What the Google Sheets (registrationSheet.ts, floorSheet.ts,
 * companySheets.ts) have in common: answers stored as keys written as the
 * English form's own labels, times on the edition's clock, and user text
 * kept as text.
 */

const UNIVERSITY_LABELS: Record<string, string> = en.interviews.universities;
const LEVEL_LABELS: Record<string, string> = en.interviews.levels;
const ENGLISH_LABELS: Record<string, string> = en.interviews.english;
export const DECISION_LABELS: Record<string, string> = en.interviews.decision;
export const STAGE_NAMES: Record<string, string> = en.interviews.stage;

export function universityLabel(a: { university: string | null; university_other: string | null }): string | null {
  if (a.university === 'other') return a.university_other;
  return a.university ? (UNIVERSITY_LABELS[a.university] ?? a.university) : null;
}

export function levelLabel(level: string | null): string {
  return level ? (LEVEL_LABELS[level] ?? level) : '';
}

export function englishLabel(level: string | null): string {
  return level ? (ENGLISH_LABELS[level] ?? level) : '';
}

export function yesNo(value: boolean | null): string {
  return value === null ? '' : value ? 'Yes' : 'No';
}

/**
 * A leading apostrophe makes Sheets keep a value as typed: a name starting
 * with "=" stays a name rather than becoming a formula, and "05…" keeps its 0.
 */
export function plain(value: string | null | undefined): string {
  return value ? `'${value}` : '';
}

/** "2026-10-12, 14:05" on the edition's clock. */
export function stamp(iso: string | null, zone: string): string {
  if (!iso) return '';
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

/** "2026-10-12" on the edition's clock. */
export function dayOf(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );
}

/** "2:00 PM" on the edition's clock. */
export function timeOf(iso: string | null, zone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(
    new Date(iso),
  );
}

/** PostgREST answers at most 1000 rows a request; an edition has more than that of most things. */
export async function pages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>,
): Promise<T[]> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data } = await fetchPage(from, from + size - 1);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < size) return rows;
  }
}

/** A bold, frozen header row: the formatting every flat tab shares. */
export function headerRowFormat(sheetId: number): object[] {
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
  ];
}

/** Shows or hides each column; `hidden[i]` for column i. */
export function columnVisibility(sheetId: number, hidden: boolean[]): object[] {
  return hidden.map((hiddenByUser, i) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { hiddenByUser },
      fields: 'hiddenByUser',
    },
  }));
}
