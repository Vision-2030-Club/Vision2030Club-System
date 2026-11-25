import 'server-only';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * The Final Wave (الحفل الختامي, Quroosh 0014): the projects that pitch at the
 * closing ceremony, and the quroosh guests give them from their wallet.
 *
 * Everything that matters is decided in the Quroosh database: whether giving
 * is open, the steps of 250, and whether the balance covers a gift (checked
 * under a lock on the account, so two tabs cannot spend the same quroosh).
 * A gift writes a `vote` entry on the wallet's ledger, which lowers the
 * guest's balance and never what they earned, so their own place holds.
 *
 * Every read answers null (or 'hidden') before 0014 is applied, so the pages
 * can say so instead of crashing.
 */

/** Gifts go in steps of this many quroosh (the database's CHECK says the same). */
export const FINAL_STEP = 250;

/**
 * The most a gift can be: the balance, down to a whole step. A guest's first
 * gift is at most 75% of their balance (the club's decision, 2026-11-25), the
 * same integer sum `final_give` makes, so the page offers exactly what the
 * database will accept.
 */
export function mostToGive(balance: number, firstGift: boolean): number {
  const usable = firstGift ? Math.floor((Math.max(balance, 0) * 3) / 4) : Math.max(balance, 0);
  return Math.floor(usable / FINAL_STEP) * FINAL_STEP;
}

/** hidden: guests do not see it. open: guests give. closed: results only. */
export type FinalStatus = 'hidden' | 'open' | 'closed';
export const FINAL_STATUSES: readonly FinalStatus[] = ['hidden', 'open', 'closed'];

/** `final_for_account`: a project on the guests' list. */
export type FinalProject = { id: string; name: string; brief: string | null; received: number; mine: number };

/** `final_board`: a place on the ceremony's leaderboard. */
export type FinalBoardRow = { position: number; id: string; name: string; received: number; givers: number };

/** `final_projects_admin`: a project as the managers see it. */
export type FinalProjectAdmin = {
  id: string;
  name: string;
  brief: string | null;
  position: number;
  hidden: boolean;
  received: number;
  gifts: number;
  givers: number;
};

/** 'hidden' when it was never set, and null before 0014 is applied (or without the database). */
export async function getFinalStatus(projectId: string): Promise<FinalStatus | null> {
  if (!isQurooshConfigured()) return null;
  const { data, error } = await createQurooshClient().rpc('final_status', { p_project: projectId });
  if (error || typeof data !== 'string') return null;
  return (FINAL_STATUSES as readonly string[]).includes(data) ? (data as FinalStatus) : 'hidden';
}

export async function getFinalProjectsFor(accountId: string): Promise<FinalProject[] | null> {
  const { data, error } = await createQurooshClient().rpc('final_for_account', { p_account: accountId });
  if (error) return null;
  return ((data ?? []) as FinalProject[]).map((row) => ({
    ...row,
    received: Number(row.received),
    mine: Number(row.mine),
  }));
}

/**
 * Whether this account has given yet (Quroosh 0015). Null when it cannot be
 * read, as before 0015 is applied: the page then assumes a first gift and
 * offers the lower limit.
 */
export async function getFinalHasGiven(accountId: string): Promise<boolean | null> {
  const { data, error } = await createQurooshClient().rpc('final_has_given', { p_account: accountId });
  return error || typeof data !== 'boolean' ? null : data;
}

/** The projects that collected the most, most first. */
export async function getFinalBoard(projectId: string, limit = 10): Promise<FinalBoardRow[] | null> {
  const { data, error } = await createQurooshClient().rpc('final_board', { p_project: projectId, p_limit: limit });
  if (error) return null;
  return ((data ?? []) as FinalBoardRow[]).map((row) => ({
    ...row,
    position: Number(row.position),
    received: Number(row.received),
    givers: Number(row.givers),
  }));
}

export async function getFinalProjectsAdmin(projectId: string): Promise<FinalProjectAdmin[] | null> {
  const { data, error } = await createQurooshClient().rpc('final_projects_admin', { p_project: projectId });
  if (error) return null;
  return ((data ?? []) as FinalProjectAdmin[]).map((row) => ({
    ...row,
    received: Number(row.received),
    gifts: Number(row.gifts),
    givers: Number(row.givers),
  }));
}
