import 'server-only';
import type { Stage } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';

/**
 * The way back: a Status changed in a Google Sheet (the floor sheet's day
 * tabs, or a company's own sheet) becomes the booking's stage in the app.
 * Everything else in a sheet is the app's and is simply rewritten.
 *
 * How it stays safe:
 *
 *   - Every booked row carries, in a hidden column, the booking id and the
 *     stage the system wrote there ("base", `<booking id>|<stage>`). A Status
 *     that differs from what that base shows is an edit; one that matches is
 *     just the system's own value, so reading a sheet twice changes nothing.
 *   - Compare-and-set. An edit is applied only while the booking's stage in
 *     the app is still the base: if the floor board moved the student since
 *     the sheet was last written, the app wins and the next rewrite shows its
 *     value in the sheet. A sheet never undoes a newer change. The base goes
 *     to advance_stage as p_expected (migration 0011), which compares it
 *     with the booking row locked, so even a click a millisecond earlier
 *     wins; without 0011 the comparison here is the only one.
 *   - Only a word from the sheet's own dropdown counts. A blank, a typo or
 *     anything else is ignored and put back by the next rewrite.
 *   - `mayChange` limits a file to its own bookings: a company's sheet can
 *     only move bookings of that company in that room, however its hidden
 *     columns are edited. The stage function itself (`advance_stage`) still
 *     refuses a cancelled booking or an archived edition.
 *   - Every change goes through `advance_stage` with an actor naming the
 *     sheet, so the audit log says it came from a Google Sheet. Google does
 *     not say which person typed it.
 *
 * Applied in two places: just before a sync rewrites a sheet (so an edit is
 * never overwritten before it is read), and every minute by the pull
 * (/api/interviews/sheets), for sheets nothing else is rewriting.
 */

export type SheetEdit = { bookingId: string; base: Stage; label: string };

export type PullRules = {
  /** What the sheet shows for a stage (the system's own word). */
  labelOf: (stage: Stage) => string;
  /** The stage a word from the sheet's dropdown means, if it is one. */
  stageOf: (label: string) => Stage | undefined;
  actor: Record<string, unknown>;
  /** Which bookings this file may move, by the booking's company and room. */
  mayChange?: (booking: { company_id: string; room_id: string }) => boolean;
};

export type PullResult = {
  /** Edits that became the booking's stage. */
  applied: number;
  /** Edits the app had already overtaken; the app's value stays. */
  conflicts: number;
  /** Cells that differed from the system's value but were not a usable edit. */
  ignored: number;
};

const STAGES = new Set<Stage>(['scheduled', 'arrived', 'in_interview', 'done', 'no_show']);

export function encodeBase(bookingId: string, stage: Stage): string {
  return `${bookingId}|${stage}`;
}

/** A row's base, or null for a free slot or a cell someone tampered with. */
export function parseBase(value: string | undefined): { bookingId: string; stage: Stage } | null {
  const [bookingId, stage] = (value ?? '').split('|');
  if (!bookingId || !/^[\w-]+$/.test(bookingId) || !STAGES.has(stage as Stage)) return null;
  return { bookingId, stage: stage as Stage };
}

/** The edits among a tab's rows: every booked row whose Status differs from its base. */
export function editsIn(rows: string[][], blocks: number[], baseCol: number, statusCol: number, rules: PullRules): SheetEdit[] {
  const edits: SheetEdit[] = [];
  for (const row of rows) {
    for (const start of blocks) {
      const base = parseBase(row[start + baseCol]);
      if (!base) continue;
      const label = (row[start + statusCol] ?? '').trim();
      if (label === rules.labelOf(base.stage)) continue;
      edits.push({ bookingId: base.bookingId, base: base.stage, label });
    }
  }
  return edits;
}

export function emptyResult(): PullResult {
  return { applied: 0, conflicts: 0, ignored: 0 };
}

export function addResults(a: PullResult, b: PullResult): PullResult {
  return { applied: a.applied + b.applied, conflicts: a.conflicts + b.conflicts, ignored: a.ignored + b.ignored };
}

export async function applySheetEdits(edits: SheetEdit[], rules: PullRules): Promise<PullResult> {
  const result = emptyResult();
  if (edits.length === 0) return result;
  const db = createInterviewsClient();

  const ids = [...new Set(edits.map((e) => e.bookingId))];
  const { data: bookingRows } = await db
    .from('bookings')
    .select('id, stage, company_id, slot_id')
    .in('id', ids)
    .is('cancelled_at', null);
  const bookings = new Map(
    ((bookingRows ?? []) as { id: string; stage: Stage; company_id: string; slot_id: string }[]).map((b) => [b.id, b]),
  );
  const slotIds = [...new Set([...bookings.values()].map((b) => b.slot_id))];
  const { data: slotRows } = slotIds.length
    ? await db.from('slots').select('id, room_id').in('id', slotIds)
    : { data: [] };
  const roomOfSlot = new Map(((slotRows ?? []) as { id: string; room_id: string }[]).map((s) => [s.id, s.room_id]));

  for (const edit of edits) {
    const to = rules.stageOf(edit.label);
    const booking = bookings.get(edit.bookingId);
    if (!to || !booking) {
      result.ignored++;
      continue;
    }
    const room_id = roomOfSlot.get(booking.slot_id) ?? '';
    if (rules.mayChange && !rules.mayChange({ company_id: booking.company_id, room_id })) {
      result.ignored++;
      console.warn('[interviews/sheetPull] a sheet tried to move a booking it does not show', edit.bookingId);
      continue;
    }
    if (booking.stage !== edit.base) {
      result.conflicts++;
      continue;
    }
    if (booking.stage === to) continue;

    const args = { p_booking: edit.bookingId, p_to: to, p_actor: rules.actor, p_as_manager: true };
    // p_expected (0011) makes the check above and the change one locked step
    // in the database, so a floor-board click in between cannot be
    // overwritten. Before 0011 is applied the parameter is unknown, and the
    // check above is all there is.
    let { error } = await db.rpc('advance_stage', { ...args, p_expected: edit.base });
    if (error?.code === 'PGRST202') ({ error } = await db.rpc('advance_stage', args));
    if (error?.hint === 'stage_changed') {
      result.conflicts++;
    } else if (error) {
      result.ignored++;
    } else {
      result.applied++;
      booking.stage = to;
    }
  }
  return result;
}
