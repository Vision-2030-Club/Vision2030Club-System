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

// -----------------------------------------------------------------------------
// Drawing: the club's sheet templates (5th edition) as Sheets API requests
// -----------------------------------------------------------------------------

export type Rgb = { red: number; green: number; blue: number };

/** "0E5A67" → the 0–1 RGB the Sheets API takes. */
export function hex(value: string): Rgb {
  const n = parseInt(value, 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

export type Box = { sheetId: number; r0: number; r1: number; c0: number; c1: number };

function gridRange(b: Box) {
  return { sheetId: b.sheetId, startRowIndex: b.r0, endRowIndex: b.r1, startColumnIndex: b.c0, endColumnIndex: b.c1 };
}

export type CellStyle = {
  bg?: Rgb;
  fg?: Rgb;
  bold?: boolean;
  size?: number;
  align?: 'LEFT' | 'CENTER' | 'RIGHT';
};

/** One style over a box. Every property is written, so a box can be restyled without leftovers. */
export function paint(b: Box, style: CellStyle): object {
  return {
    repeatCell: {
      range: gridRange(b),
      cell: {
        userEnteredFormat: {
          backgroundColor: style.bg ?? hex('FFFFFF'),
          textFormat: {
            foregroundColor: style.fg ?? hex('000000'),
            bold: style.bold ?? false,
            fontSize: style.size ?? 10,
          },
          horizontalAlignment: style.align ?? 'LEFT',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  };
}

export function merge(b: Box): object {
  return { mergeCells: { range: gridRange(b), mergeType: 'MERGE_ALL' } };
}

/** The same row-by-row merge over each row of a box (a Notes cell spanning two columns). */
export function mergeRows(b: Box): object {
  return { mergeCells: { range: gridRange(b), mergeType: 'MERGE_ROWS' } };
}

/** Thin lines around and inside a box. */
export function grid(b: Box, color: Rgb): object {
  const line = { style: 'SOLID', color };
  return {
    updateBorders: {
      range: gridRange(b),
      top: line,
      bottom: line,
      left: line,
      right: line,
      innerHorizontal: line,
      innerVertical: line,
    },
  };
}

/** A strict dropdown. Values the system writes that are not in the list are still accepted from the API. */
export function dropdown(b: Box, values: string[]): object {
  return {
    setDataValidation: {
      range: gridRange(b),
      rule: {
        condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) },
        showCustomUi: true,
        strict: true,
      },
    },
  };
}

/** Colours a cell by its exact text, recalculated the moment the text changes. */
export function whenText(b: Box, text: string, style: { bg: Rgb; fg?: Rgb }): object {
  return {
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [gridRange(b)],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: text }] },
          format: { backgroundColor: style.bg, ...(style.fg ? { textFormat: { foregroundColor: style.fg } } : {}) },
        },
      },
    },
  };
}

/** The Status colours both kinds of sheet share: a traffic light, plus grey for a gap. */
export const STATUS_TONES = {
  done: { bg: hex('B7E1CD'), fg: hex('0D652D') },
  arrived: { bg: hex('C9DAF8'), fg: hex('1C4587') },
  inside: { bg: hex('FFE599'), fg: hex('7F6000') },
  missed: { bg: hex('F4C7C3'), fg: hex('990000') },
  gap: { bg: hex('D9D9D9'), fg: hex('434343') },
} satisfies Record<string, { bg: Rgb; fg: Rgb }>;

/** One `whenText` rule per Status word, so a cell recolours the moment its Status changes. */
export function statusColours(b: Box, tones: Record<string, { bg: Rgb; fg: Rgb }>): object[] {
  return Object.entries(tones).map(([text, style]) => whenText(b, text, style));
}

/** Pixel widths from `startCol` on. */
export function widths(sheetId: number, startCol: number, px: number[]): object[] {
  return px.map((pixelSize, i) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: startCol + i, endIndex: startCol + i + 1 },
      properties: { pixelSize },
      fields: 'pixelSize',
    },
  }));
}

export function hideColumn(sheetId: number, col: number): object {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 },
      properties: { hiddenByUser: true },
      fields: 'hiddenByUser',
    },
  };
}

/**
 * What people typed by hand into a column the system leaves to them (the
 * floor's Notes, a company's Interviewer), read off the sheet before a
 * rewrite and keyed by the hidden key column of the same row, so the rewrite
 * can put each value back on the row it belongs to. `blocks` is the starting
 * column of each block of a row (the floor has two rooms side by side).
 */
export function keptValues(rows: string[][], blocks: number[], keyCol: number, valueCol: number): Map<string, string> {
  const kept = new Map<string, string>();
  for (const row of rows) {
    for (const start of blocks) {
      const key = row[start + keyCol];
      const value = row[start + valueCol];
      if (key && value) kept.set(key, value);
    }
  }
  return kept;
}
