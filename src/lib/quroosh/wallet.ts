import 'server-only';
import { listCheckIns } from '@/lib/eventAttendance/api';
import { createQurooshClient } from '@/lib/supabase/quroosh';

/**
 * The wallet (Quroosh 0007): the quroosh a guest collects during the event.
 *
 * The ledger lives in the Quroosh database. This file reads it for the
 * guest's pages and the managers' page, and `syncWallet` is the one path
 * that writes to it today: a day's attendance, read from Event attendance's
 * check-ins the same way the accounts are (src/lib/quroosh/accountSync.ts),
 * with a cursor of its own.
 *
 * Two numbers, different on purpose: `balance` is what a guest can spend,
 * `earned` is what they are ranked by, so that voting never costs a place.
 *
 * Every read answers null (or an empty list) before 0007 is applied, so the
 * pages can say so instead of crashing.
 */

export type WalletKind = 'attendance' | 'challenge' | 'vote' | 'adjustment' | 'session';

export type WalletOverview = { balance: number; earned: number; position: number; players: number };
export type WalletEntry = { id: string; kind: WalletKind; amount: number; day: string | null; created_at: string };
export type LeaderboardRow = { position: number; account_id: string; name: string; earned: number };
export type WalletTotals = { distributed: number; spent: number; holders: number; entries: number };
export type LedgerRow = WalletEntry & { account_id: string; name: string; voided_at: string | null };

/** Quroosh are whole numbers, grouped, in Latin digits in both languages. */
export function formatQuroosh(amount: number): string {
  return new Intl.NumberFormat('en-US').format(amount);
}

/** The same with its sign, for a ledger line. */
export function formatSigned(amount: number): string {
  return `${amount > 0 ? '+' : '−'}${formatQuroosh(Math.abs(amount))}`;
}

/**
 * A name as other guests see it: the first name and the first letter of the
 * last, as the Quroosh design shows on the big screen. Nobody's full name is
 * shown to the public.
 */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${[...parts[parts.length - 1]][0]}.`;
}

export async function getWalletOverview(accountId: string): Promise<WalletOverview | null> {
  const { data, error } = await createQurooshClient().rpc('wallet_overview', { p_account: accountId });
  const row = (data as WalletOverview[] | null)?.[0];
  if (error || !row) return null;
  return {
    balance: Number(row.balance),
    earned: Number(row.earned),
    position: Number(row.position),
    players: Number(row.players),
  };
}

export async function getWalletEntries(accountId: string, limit = 50): Promise<WalletEntry[]> {
  const { data } = await createQurooshClient().rpc('wallet_entries_of', { p_account: accountId, p_limit: limit });
  return (data ?? []) as WalletEntry[];
}

/** Null before 0007 is applied; an empty list when nobody has earned yet. */
export async function getLeaderboard(projectId: string, limit = 20): Promise<LeaderboardRow[] | null> {
  const { data, error } = await createQurooshClient().rpc('wallet_leaderboard', { p_project: projectId, p_limit: limit });
  if (error) return null;
  return ((data ?? []) as LeaderboardRow[]).map((row) => ({
    ...row,
    position: Number(row.position),
    earned: Number(row.earned),
  }));
}

export async function getAttendancePoints(projectId: string): Promise<number | null> {
  const { data, error } = await createQurooshClient().rpc('wallet_attendance_points', { p_project: projectId });
  return error || typeof data !== 'number' ? null : data;
}

// -----------------------------------------------------------------------------
// Earning from attendance
// -----------------------------------------------------------------------------

/** See accountSync.ts: a check-in can commit just behind the cursor. */
const OVERLAP_MS = 2 * 60 * 1000;

/**
 * Pays the day's quroosh for each check-in read since last time, and takes
 * back those the gate undid. Run after `syncGuestAccounts`, so the people
 * who have just arrived already have their account.
 *
 * `fromStart` reads every check-in again (the managers' "Recount"). That is
 * safe at any time: a check-in already paid is not paid twice.
 *
 * Reads a page at a time, a few pages on an ordinary pass (the next sweep
 * takes the rest) and as many as a whole event needs on a recount. Throws
 * when either database refuses; the callers that run unattended catch that.
 */
export async function syncWallet(projectId: string, options: { fromStart?: boolean } = {}): Promise<number> {
  const quroosh = createQurooshClient();
  let since: string | null = null;
  if (!options.fromStart) {
    const { data, error } = await quroosh.rpc('wallet_sync_state', { p_project: projectId });
    if (error) throw new Error(error.message);
    since = typeof data === 'string' ? back(data, OVERLAP_MS) : null;
  }

  let written = 0;
  let reached: string | null = null;
  for (let page = 0; page < (options.fromStart ? 40 : 5); page += 1) {
    const checkIns = await listCheckIns(projectId, since);
    // The list comes oldest change first: the last row is the furthest read.
    const last = checkIns.at(-1)?.changed_at ?? null;
    const { data, error } = await quroosh.rpc('sync_wallet', {
      p_project: projectId,
      p_check_ins: checkIns.map((checkIn) => ({
        id: checkIn.id,
        attendee_id: checkIn.attendee_id,
        day: checkIn.day,
        undone: checkIn.undone_at !== null,
      })),
      p_cursor: last,
    });
    if (error) throw new Error(error.message);
    written += Number(data ?? 0);
    // Nothing further than last time: everything has been read. (Not "a short
    // page": the API may hand back fewer rows than the 5000 it promises.)
    if (!last || last === reached) break;
    reached = last;
    // A second back, so rows sharing the last row's time are not stepped over.
    since = back(last, 1000);
  }
  return written;
}

function back(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() - ms).toISOString();
}
