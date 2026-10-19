'use server';

import { cookies } from 'next/headers';
import { fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import type { EditionSettings } from '@/lib/interviews/types';
import { VISITOR_QUESTIONS, visitorFeedbackOpen } from '@/lib/interviews/visitorFeedback';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';

/** The cookie that says this device already answered this edition's form. */
export async function answeredCookie(slug: string): Promise<string> {
  return `vf_${slug}`;
}

/**
 * A visitor's feedback (0018, anonymous since 0019: no phone number). The
 * page checks the cheap things (the link, open, every question answered);
 * the database checks them again. A cookie remembers that this device
 * answered, so the page thanks it instead of asking again.
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

  const answers: Record<string, number> = {};
  for (const q of VISITOR_QUESTIONS) {
    const n = Number(text(formData, q));
    if (![1, 2, 3, 4].includes(n)) return fail('Answer every question.', 'bad_answers');
    answers[q] = n;
  }

  const { data, error } = await db.rpc('submit_visitor_feedback', {
    p_edition: edition.id,
    p_phone: null,
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
  const jar = await cookies();
  jar.set(await answeredCookie(slug), '1', { path: '/', maxAge: 60 * 60 * 24 * 60, httpOnly: true, sameSite: 'lax' });
  return ok((data as { replaced?: boolean } | null)?.replaced ? 'replaced' : 'sent');
}
