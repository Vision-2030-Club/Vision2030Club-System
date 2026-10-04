import 'server-only';
import { after } from 'next/server';
import { GoogleNotConnectedError } from '@/lib/google/auth';
import { refreshCompanySheets } from '@/lib/interviews/companySheets';
import { syncFloorSheet } from '@/lib/interviews/floorSheet';
import { refreshRegistrationSheet } from '@/lib/interviews/registrationSheet';

/**
 * Brings every Google Sheet of an edition up to date after something
 * changed: the floor sheet, each company's sheet, and the registrations
 * sheet's Accepted / Rejected / Booked columns. Called after bookings, stage
 * changes and HR decisions; each sheet module decides for itself whether it
 * has anything to write (the company and registrations sheets skip Google
 * when their rows are unchanged).
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

/** Each sheet on its own: one failing (a sheet deleted in Drive) must not stop the others. */
async function syncAll(editionId: string): Promise<void> {
  const steps: [string, () => Promise<void>][] = [
    ['floor', () => syncFloorSheet(editionId)],
    ['companies', () => refreshCompanySheets(editionId)],
    ['registrations', () => refreshRegistrationSheet(editionId)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      if (error instanceof GoogleNotConnectedError) return;
      console.error(`[interviews/sheetsSync] ${name} sheet failed`, error);
    }
  }
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
    do {
      state.again = false;
      await syncAll(editionId);
    } while (state.again);
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
