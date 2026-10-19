import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { siteUrl } from './email';

/**
 * Visitor feedback (0018): the students who checked in rate the event on a
 * public link, like the apply form's (/interviews/visit/<public slug>).
 * Open only while `visitor_feedback_open` is on (Settings tab). Since 0019 the
 * form asks no phone number: answers are anonymous, and the page remembers on
 * the device that it already answered (a cookie), so one phone does not send
 * twice by accident.
 *
 * The questions are fixed here and in the catalogs (`visitorFeedback.q.*`);
 * the database checks the same four keys.
 */
export const VISITOR_QUESTIONS = ['event_quality', 'club_goals', 'activities', 'team'] as const;
export type VisitorQuestion = (typeof VISITOR_QUESTIONS)[number];

/** Best first: 4 Excellent, 3 Good, 2 Acceptable, 1 Not good (`visitorFeedback.scale.<n>`). */
export const VISITOR_SCALE = [4, 3, 2, 1] as const;

export function visitorFeedbackOpen(settings: { visitor_feedback_open?: unknown } | null | undefined): boolean {
  return settings?.visitor_feedback_open === true;
}

/** The address students open (the QR code at the venue). */
export function visitorFeedbackUrl(locale: string, slug: string): string {
  return `${siteUrl()}/${locale}/interviews/visit/${slug}`;
}

export type VisitorSummary = {
  /** False until 0018 is applied. */
  ready: boolean;
  total: number;
  /** Per question: how many chose each value (4…1). */
  counts: Record<VisitorQuestion, Record<number, number>>;
  /** The written comments, newest first. No names: the answers are anonymous (0019). */
  comments: { comment: string; at: string }[];
};

export async function loadVisitorSummary(db: SupabaseClient, editionId: string): Promise<VisitorSummary> {
  const counts = Object.fromEntries(
    VISITOR_QUESTIONS.map((q) => [q, { 4: 0, 3: 0, 2: 0, 1: 0 }]),
  ) as unknown as VisitorSummary['counts'];
  const { data, error } = await db
    .from('visitor_feedback')
    .select('answers, comment, updated_at')
    .eq('edition_id', editionId)
    .order('updated_at', { ascending: false });
  if (error) return { ready: false, total: 0, counts, comments: [] };

  type Row = { answers: Record<string, number>; comment: string | null; updated_at: string };
  const rows = (data ?? []) as unknown as Row[];
  const comments: VisitorSummary['comments'] = [];
  for (const row of rows) {
    for (const q of VISITOR_QUESTIONS) {
      const value = row.answers?.[q];
      if (value in counts[q]) counts[q][value] += 1;
    }
    if (row.comment) comments.push({ comment: row.comment, at: row.updated_at });
  }
  return { ready: true, total: rows.length, counts, comments };
}
