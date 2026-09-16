'use server';

import { revalidatePath } from 'next/cache';
import { fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { kickEmailDelivery } from '@/lib/interviews/email';
import { isToken } from '@/lib/interviews/tokens';
import { createInterviewsClient } from '@/lib/supabase/interviews';

/**
 * The student's three moves. Each hands the personal token to a function
 * that resolves it again and enforces the window, the cutoff and the
 * one-slot-per-company rule — this file carries fields, nothing more.
 */

function page(locale: string, token: string) {
  return `/${locale}/interviews/s/${token}`;
}

export async function bookAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const token = requiredText(formData, 'token');
  const locale = requiredText(formData, 'locale');
  if (!isToken(token)) return fail('Bad link.', 'bad_link');

  const db = createInterviewsClient();
  const { error } = await db.rpc('book_slot', {
    p_token: token,
    p_slot: requiredText(formData, 'slot_id'),
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  revalidatePath(page(locale, token));
  return ok('created');
}

export async function moveAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const token = requiredText(formData, 'token');
  const locale = requiredText(formData, 'locale');
  if (!isToken(token)) return fail('Bad link.', 'bad_link');

  const db = createInterviewsClient();
  const { error } = await db.rpc('move_booking', {
    p_token: token,
    p_booking: requiredText(formData, 'booking_id'),
    p_slot: requiredText(formData, 'slot_id'),
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  revalidatePath(page(locale, token));
  return ok();
}

export async function cancelAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const token = requiredText(formData, 'token');
  const locale = requiredText(formData, 'locale');
  if (!isToken(token)) return fail('Bad link.', 'bad_link');

  const db = createInterviewsClient();
  const { error } = await db.rpc('cancel_booking', {
    p_token: token,
    p_booking: requiredText(formData, 'booking_id'),
    p_reason: text(formData, 'reason'),
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  revalidatePath(page(locale, token));
  return ok();
}
