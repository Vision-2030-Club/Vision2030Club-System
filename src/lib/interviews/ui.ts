import type { Decision, Stage } from '@/lib/interviews/types';

/** Badge tones shared by every page that shows a decision or a stage. */
export const DECISION_TONES: Record<Decision, 'neutral' | 'ok' | 'danger'> = {
  pending: 'neutral',
  accepted: 'ok',
  rejected: 'danger',
};

export const STAGE_TONES: Record<Stage, 'neutral' | 'brand' | 'warn' | 'ok' | 'danger'> = {
  scheduled: 'neutral',
  arrived: 'brand',
  in_interview: 'warn',
  done: 'ok',
  no_show: 'danger',
};

/**
 * What an organizer may press from each stage: one step forward, one step
 * back. No-shows are the reception desk's (checkInAction, 2026-10-19), and
 * stageAction refuses them to organizers; this only decides which buttons to
 * draw.
 */
export const ORGANIZER_MOVES: Record<Stage, Stage[]> = {
  // Checking in (and undoing it) is Reception's (2026-10-20).
  scheduled: [],
  arrived: ['in_interview'],
  in_interview: ['done', 'arrived'],
  done: ['in_interview'],
  // No-shows are marked and cleared at Reception (2026-10-19).
  no_show: [],
};

/** Moves that go forward (drawn as the primary button) versus corrections. */
export const FORWARD_MOVES = new Set<string>([
  'scheduled>arrived',
  'arrived>in_interview',
  'in_interview>done',
]);
