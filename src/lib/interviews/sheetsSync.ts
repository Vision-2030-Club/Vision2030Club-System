import 'server-only';
import { after } from 'next/server';
import { GoogleNotConnectedError, isGoogleConfigured } from '@/lib/google/auth';
import { modifiedTimes } from '@/lib/google/sheets';
import { companySheetIds, pullCompanySheets, refreshCompanySheets } from '@/lib/interviews/companySheets';
import { floorSheetId, pullFloorSheet, syncFloorSheet } from '@/lib/interviews/floorSheet';
import { refreshRegistrationSheet } from '@/lib/interviews/registrationSheet';
import { addResults, emptyResult, type PullResult } from '@/lib/interviews/sheetPull';

/**
 * Keeps every Google Sheet of an edition and the app in agreement, both
 * ways: the floor sheet, each company's sheets, and the registrations
 * sheet's Accepted / Rejected / Booked columns.
 *
 * App → sheets: kickSheetsSync, after bookings, stage changes and HR
 * decisions. Each sheet module decides for itself whether it has anything to
 * write (the company and registrations sheets skip Google when their rows
 * are unchanged). The floor and company sheets first apply any Status edit
 * waiting in them (sheetPull.ts), so a rewrite never loses one; when an edit
 * moved a booking, the round runs again so every other sheet shows it too.
 *
 * Sheets → app: pullSheets, every minute from /api/interviews/sheets, reads
 * only the files Google Drive says changed since they were last read here,
 * applies their Status edits, and runs a sync round if anything moved or a
 * sheet needs correcting.
 *
 * Syncs in flight, per edition, on this server instance. A rebuild is a
 * dozen Google calls; two bookings seconds apart used to start two rebuilds
 * that raced each other over the same tabs (both claiming the spare tab,
 * one deleting what the other had just written). Now a second request that
 * arrives while one is running only leaves a note, and the running one goes
 * round once more when it finishes — so the sheets end up reflecting the
 * latest state, with at most two rebuilds for any burst.
 */
const inFlight = new Map<string, { again: boolean }>();

/** Rounds after a sheet edit moved a booking, before giving the rest to the next sync. */
const MAX_ROUNDS = 3;

/** One round over every sheet, each on its own: one failing (a file deleted in Drive) must not stop the others. */
async function syncAll(editionId: string): Promise<PullResult> {
  let result = emptyResult();
  const steps: [string, () => Promise<PullResult | void>][] = [
    ['floor', () => syncFloorSheet(editionId)],
    ['companies', () => refreshCompanySheets(editionId)],
    ['registrations', () => refreshRegistrationSheet(editionId)],
  ];
  for (const [name, step] of steps) {
    try {
      const pulled = await step();
      if (pulled) result = addResults(result, pulled);
    } catch (error) {
      if (error instanceof GoogleNotConnectedError) return result;
      console.error(`[interviews/sheetsSync] ${name} sheet failed`, error);
    }
  }
  return result;
}

async function syncCoalesced(editionId: string): Promise<void> {
  const running = inFlight.get(editionId);
  if (running) {
    running.again = true;
    return;
  }
  const state = { again: false };
  inFlight.set(editionId, state);
  try {
    let rounds = 0;
    do {
      state.again = false;
      const pulled = await syncAll(editionId);
      // A company's edit lands after the floor sheet was written this round.
      if (pulled.applied) state.again = true;
      rounds++;
    } while (state.again && rounds < MAX_ROUNDS);
  } finally {
    inFlight.delete(editionId);
  }
}

/**
 * Fire-and-forget, after the response has gone out — same pattern as
 * kickEmailDelivery. A Google hiccup (not connected yet, a revoked token,
 * a rate limit) must never fail the action that triggered it; it is logged
 * and the next change tries again.
 */
export function kickSheetsSync(editionId: string): void {
  after(() => syncCoalesced(editionId));
}

/** When this instance last read each file, by Drive's modifiedTime: what the pull skips. */
const lastRead = new Map<string, string>();

/**
 * The every-minute pull. One Drive request says when each file last changed;
 * only files that moved since this instance last read them are read (one
 * Sheets request each). Our own rewrites move them too, so a file is read
 * once after each rewrite; a fresh instance reads every file once.
 */
export async function pullSheets(editionId: string): Promise<PullResult> {
  if (!isGoogleConfigured()) return emptyResult();

  const [floorId, companyIds, times] = await Promise.all([floorSheetId(editionId), companySheetIds(editionId), modifiedTimes()]);
  const changed = (id: string) => Boolean(times.get(id)) && lastRead.get(id) !== times.get(id);
  // Marked only once a file was read and applied: a failed read is tried again next minute.
  const read = (id: string) => lastRead.set(id, times.get(id)!);

  let result = emptyResult();
  if (floorId && changed(floorId)) {
    result = addResults(result, await pullFloorSheet(editionId));
    read(floorId);
  }
  if (companyIds.some(changed)) result = addResults(result, await pullCompanySheets(editionId, changed, read));

  // Something moved, or a sheet shows a value the app refused: one round puts every sheet right.
  if (result.applied || result.conflicts || result.ignored) await syncCoalesced(editionId);
  return result;
}
