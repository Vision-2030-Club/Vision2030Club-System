import 'server-only';
import { TOKEN_PATTERN } from '@/lib/interviews/tokens';
import { siteUrl } from '@/lib/site';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * The booths' challenges (Quroosh 0008): a few multiple-choice questions a
 * guest answers once, paid into their wallet for being right and quick.
 *
 * Everything that matters is decided in the Quroosh database: which question
 * an attempt is on, how long an answer took (its clock, not the phone's),
 * whether it was right, and the points. This file only reads and types what
 * the pages show. The right option is never among what a guest's page reads.
 */

/** `challenge_by_token`: the challenge behind a booth's QR code. */
export type Challenge = {
  id: string;
  project_id: string;
  booth: string;
  topic: string | null;
  seconds_per_question: number;
  max_points: number;
  questions: number;
  playable: boolean;
};

/** `challenge_state`: where a guest is with a challenge. */
export type ChallengeState =
  | { status: 'new' }
  | {
      status: 'open';
      number: number;
      total: number;
      seconds: number;
      remaining_ms: number;
      question: { id: string; prompt: string; options: string[] };
    }
  | { status: 'done'; correct: number; total: number; ms: number; points: number; place: number; players: number };

/** `challenges_for_account`: one line of the guest's list. */
export type GuestChallenge = {
  id: string;
  booth: string;
  topic: string | null;
  questions: number;
  max_points: number;
  status: 'new' | 'open' | 'done';
  points: number | null;
  /** What the booth's QR code holds, so the guest's list can open the challenge with a tap. */
  token: string | null;
};

/** `challenge_list`: one line of the managers' list. */
export type ChallengeRow = {
  id: string;
  token: string;
  booth: string;
  topic: string | null;
  day: string | null;
  seconds_per_question: number;
  max_points: number;
  active: boolean;
  questions: number;
  attempts: number;
  average_points: number;
};

/** `challenge_questions_list`: a question as managers see it, right option included. */
export type QuestionRow = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  correct: number;
  hidden: boolean;
  answered: number;
  right_answers: number;
};

/** `challenge_top`: a finished attempt, with the full name. Managers only. */
export type TopAttempt = {
  account_id: string;
  name: string;
  points: number;
  correct_count: number;
  total_ms: number;
  finished_at: string;
};

/** What a booth's QR code holds. Always the production site, like every link people are handed. */
export function challengeUrl(locale: string, token: string): string {
  return `${siteUrl()}/${locale}/quroosh/challenge/${token}`;
}

/** The challenge behind a code, or null: unknown code, or 0008 not applied yet. */
export async function getChallengeByToken(token: string): Promise<Challenge | null> {
  if (!TOKEN_PATTERN.test(token) || !isQurooshConfigured()) return null;
  const { data } = await createQurooshClient().rpc('challenge_by_token', { p_token: token });
  const row = ((data as Challenge[] | null) ?? [])[0];
  return row ? { ...row, questions: Number(row.questions) } : null;
}

export async function getChallengeState(accountId: string, challengeId: string): Promise<ChallengeState | null> {
  const { data, error } = await createQurooshClient().rpc('challenge_state', {
    p_account: accountId,
    p_challenge: challengeId,
  });
  return error ? null : ((data as ChallengeState | null) ?? null);
}

/**
 * Null before 0008 is applied; an empty list when no booth has a challenge today.
 *
 * Each line carries its challenge's token, so a guest can open it from the
 * list instead of scanning the booth's QR code. `challenges_for_account`
 * does not return tokens, so they are read from the project's list on the
 * server; only the tokens of the challenges this guest already sees leave it.
 */
export async function getGuestChallenges(accountId: string, projectId: string): Promise<GuestChallenge[] | null> {
  const db = createQurooshClient();
  const [mine, all] = await Promise.all([
    db.rpc('challenges_for_account', { p_account: accountId }),
    db.rpc('challenge_list', { p_project: projectId }),
  ]);
  if (mine.error) return null;
  const tokens = new Map(((all.data ?? []) as ChallengeRow[]).map((row) => [row.id, row.token]));
  return ((mine.data ?? []) as Omit<GuestChallenge, 'token'>[]).map((row) => ({
    ...row,
    questions: Number(row.questions),
    token: tokens.get(row.id) ?? null,
  }));
}

/** Seconds with one decimal, for "your time". */
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}
