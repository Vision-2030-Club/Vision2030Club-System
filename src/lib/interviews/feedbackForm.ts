/**
 * The shape of the interviewer's feedback form, from the edition's settings
 * (Settings tab), so it can be changed without a deploy or a migration:
 *
 *   rating_labels     the rated questions (key, en, ar), as before
 *   rating_scale      5 → each question is rated 1–5 (the default, and what
 *                     the April 2026 edition used); 3 → Excellent / Good /
 *                     Needs improvement, stored as 3 / 2 / 1
 *   feedback_comment  { en, ar }: one open question replacing the three
 *                     boxes (strengths, to improve, overall note). Its answer
 *                     is stored in `improvements`. Absent → the three boxes.
 *
 * `feedback.ratings` keeps plain numbers either way, so nothing in the
 * database changes; only how they are asked and shown.
 */
export type RatingScale = 3 | 5;
export type CommentQuestion = { en: string; ar: string };

export function ratingScale(settings: { rating_scale?: unknown } | null | undefined): RatingScale {
  return Number(settings?.rating_scale) === 3 ? 3 : 5;
}

export function commentQuestion(settings: { feedback_comment?: unknown } | null | undefined): CommentQuestion | null {
  const value = settings?.feedback_comment as Partial<CommentQuestion> | null | undefined;
  if (!value || typeof value !== 'object') return null;
  const en = typeof value.en === 'string' ? value.en.trim() : '';
  const ar = typeof value.ar === 'string' ? value.ar.trim() : '';
  return en || ar ? { en: en || ar, ar: ar || en } : null;
}

/** The values a rating may take, best first. */
export function scaleValues(scale: RatingScale): number[] {
  return scale === 3 ? [3, 2, 1] : [1, 2, 3, 4, 5];
}

/** The translation key (under `interviews.feedbackScale`) for a value on the three-step scale. */
export function scaleWordKey(value: number): 'excellent' | 'good' | 'needsImprovement' {
  return value >= 3 ? 'excellent' : value === 2 ? 'good' : 'needsImprovement';
}
