'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { kickEmailDelivery } from '@/lib/interviews/email';
import { isToken } from '@/lib/interviews/tokens';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { pinCookieName, pinCookieValue } from '@/lib/interviews/pin';

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
 * The interviewer's feedback on one booking. `submit_feedback` resolves the
 * company from the token, so a link can only ever write about its own list.
 */
export async function feedbackAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const token = requiredText(formData, 'token');
  const locale = requiredText(formData, 'locale');
  if (!isToken(token)) return fail('Bad link.', 'bad_link');

  const ratings: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('rating_') && typeof value === 'string' && value) {
      const n = Number(value);
      if (n >= 1 && n <= 5) ratings[key.slice('rating_'.length)] = n;
    }
  }

  const db = createInterviewsClient();
  const { error } = await db.rpc('submit_feedback', {
    p_company_token: token,
    p_booking: requiredText(formData, 'booking_id'),
    p_payload: {
      ratings,
      strengths: text(formData, 'strengths'),
      improvements: text(formData, 'improvements'),
      overall: text(formData, 'overall'),
    },
  });
  if (error) return fromPostgrest(error);

  // Only matters when the edition sends feedback immediately; otherwise the
  // row waits for the club to release it.
  kickEmailDelivery();
  revalidatePath(page(locale, token));
  return ok();
}
