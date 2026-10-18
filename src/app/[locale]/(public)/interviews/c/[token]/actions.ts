'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { kickEmailDelivery } from '@/lib/interviews/email';
import { companyFinishes } from '@/lib/interviews/companyFinish';
import { kickSheetsSync } from '@/lib/interviews/sheetsSync';
import { isToken } from '@/lib/interviews/tokens';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { pinCookieName, pinCookieValue } from '@/lib/interviews/pin';
import { ratingScale, scaleValues } from '@/lib/interviews/feedbackForm';

function page(locale: string, token: string) {
  return `/${locale}/interviews/c/${token}`;
}

/** Checks the PIN against the company the link belongs to, then remembers it for the day. */
export async function enterPinAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const token = requiredText(formData, 'token');
  const locale = requiredText(formData, 'locale');
  const pin = requiredText(formData, 'pin');
  if (!isToken(token)) return fail('Bad link.', 'bad_link');

  const db = createInterviewsClient();
  const { data: company } = await db
    .from('companies')
    .select('id, access_pin')
    .eq('access_token', token)
    .maybeSingle();

  if (!company || !company.access_pin || company.access_pin !== pin.trim()) {
    return fail('Wrong PIN.', 'wrong_pin');
  }

  const jar = await cookies();
  jar.set(pinCookieName(company.id as string), pinCookieValue(token, company.access_pin as string), {
    maxAge: 60 * 60 * 14,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });

  revalidatePath(page(locale, token));
  return ok();
}

/**
 * The interviewer's feedback on one booking. The database resolves the
 * company from the token, so a link can only ever write about its own list.
 *
 * While the edition lets companies finish interviews (the default,
 * companyFinish.ts), saving the feedback is also what marks the interview
 * done: `finish_interview` (0015) does both in one step. Otherwise it is the
 * feedback alone (`submit_feedback`, 0003), and the organizers mark it done.
 *
 * A company with a PIN must have entered it in this browser: the page was
 * always behind the PIN, and now so is the action behind it.
 */
export async function feedbackAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const token = requiredText(formData, 'token');
  const locale = requiredText(formData, 'locale');
  if (!isToken(token)) return fail('Bad link.', 'bad_link');

  const db = createInterviewsClient();
  const { data: company } = await db
    .from('companies')
    .select('id, edition_id, access_pin')
    .eq('access_token', token)
    .maybeSingle();
  if (!company) return fail('Bad link.', 'bad_link');
  if (company.access_pin) {
    const jar = await cookies();
    if (jar.get(pinCookieName(company.id as string))?.value !== pinCookieValue(token, company.access_pin as string)) {
      return fail('Enter the PIN first.', 'wrong_pin');
    }
  }

  const { data: settings } = await db.rpc('edition_settings', { p_edition: company.edition_id });
  const allowed = scaleValues(ratingScale(settings as { rating_scale?: unknown } | null));
  const ratings: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('rating_') && typeof value === 'string' && value) {
      const n = Number(value);
      if (allowed.includes(n)) ratings[key.slice('rating_'.length)] = n;
    }
  }
  const args = {
    p_company_token: token,
    p_booking: requiredText(formData, 'booking_id'),
    p_payload: {
      ratings,
      strengths: text(formData, 'strengths'),
      improvements: text(formData, 'improvements'),
      overall: text(formData, 'overall'),
    },
  };

  const finishes = companyFinishes(settings as { company_finishes?: unknown } | null);
  if (finishes) {
    let { error } = await db.rpc('finish_interview', args);
    // Before 0015 is applied: the same two steps, one after the other.
    if (error?.code === 'PGRST202') {
      const { strengths, improvements, overall } = args.p_payload;
      if (!Object.keys(ratings).length && !strengths && !improvements && !overall) {
        return fail('Give at least one rating or a comment.', 'empty_feedback');
      }
      ({ error } = await db.rpc('submit_feedback', args));
      if (!error) error = await finishWithoutFeedbackFunction(db, company.id as string, args.p_booking);
    }
    if (error) return fromPostgrest(error);
  } else {
    const { error } = await db.rpc('submit_feedback', args);
    if (error) return fromPostgrest(error);
  }

  // Only matters when the edition sends feedback immediately; otherwise the
  // row waits for the club to release it.
  kickEmailDelivery();
  if (finishes) kickSheetsSync(company.edition_id as string);
  revalidatePath(page(locale, token));
  return ok();
}

/**
 * The stage half of finish_interview for a database without 0015: the
 * booking becomes done through advance_stage, as the company, unless the
 * organizer marked the student as not shown.
 */
async function finishWithoutFeedbackFunction(
  db: ReturnType<typeof createInterviewsClient>,
  companyId: string,
  bookingId: string,
) {
  const { data: booking } = await db
    .from('bookings')
    .select('stage')
    .eq('id', bookingId)
    .eq('company_id', companyId)
    .is('cancelled_at', null)
    .maybeSingle();
  if (!booking || booking.stage === 'done' || booking.stage === 'no_show') return null;
  const { data: company } = await db.from('companies').select('name_en').eq('id', companyId).maybeSingle();
  const { error } = await db.rpc('advance_stage', {
    p_booking: bookingId,
    p_to: 'done',
    p_actor: { kind: 'company', id: companyId, name: company?.name_en ?? 'Company' },
    p_as_manager: true,
  });
  return error;
}
