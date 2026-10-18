'use server';

import { fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { normalisePhone } from '@/lib/interviews/phone';
import type { EditionSettings } from '@/lib/interviews/types';
import { VISITOR_QUESTIONS, visitorFeedbackOpen } from '@/lib/interviews/visitorFeedback';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';

/**
 * A student's visitor feedback (0018). The page checks the cheap things
 * (the link, open, every question answered, a phone number); the database
 * checks them again and that the phone belongs to someone who checked in,
 * and keeps one answer per student.
 */
export async function visitorFeedbackAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const slug = requiredText(formData, 'slug');
  const locale = text(formData, 'locale') === 'en' ? 'en' : 'ar';

  // The honeypot: a person never sees this field. Pretend it worked.
  if (text(formData, 'website')) return ok('sent');

  if (!isInterviewsConfigured()) return fail('Not available right now.', 'not_configured');
  const db = createInterviewsClient();
  const { data: edition } = await db.from('editions').select('id').eq('public_slug', slug).maybeSingle();
  if (!edition) return fail('This link is not recognised.', 'bad_link');
  const { data: settings } = await db.rpc('edition_settings', { p_edition: edition.id });
  if (!visitorFeedbackOpen(settings as EditionSettings | null)) {
    return fail('Visitor feedback is closed right now.', 'visitor_feedback_closed');
  }

  const phone = normalisePhone(text(formData, 'phone'));
  if (!phone || phone.length < 9) return fail('Enter a phone number.', 'missing_phone');

  const answers: Record<string, number> = {};
  for (const q of VISITOR_QUESTIONS) {
    const n = Number(text(formData, q));
    if (![1, 2, 3, 4].includes(n)) return fail('Answer every question.', 'bad_answers');
    answers[q] = n;
  }

  const { data, error } = await db.rpc('submit_visitor_feedback', {
    p_edition: edition.id,
    p_phone: phone,
    p_answers: answers,
    p_comment: text(formData, 'comment') ?? '',
    p_locale: locale,
  });
  // PGRST202: 0018 is not applied yet.
  if (error?.code === 'PGRST202') return fail('Not available right now.', 'not_configured');
  if (error) {
    const refused = fromPostgrest(error);
    if (refused.hint) return refused;
    console.error('[interviews/visit] submit failed', error.code);
    return fail('Something went wrong. Try again.', 'generic');
  }
  return ok((data as { replaced?: boolean } | null)?.replaced ? 'replaced' : 'sent');
}
