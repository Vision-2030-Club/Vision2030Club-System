'use server';

import { fail, fromPostgrest, ok, type ActionResult } from '@/lib/actions';
import { isToken } from '@/lib/interviews/tokens';
import { UUID } from '@/lib/quroosh/guestActions';
import { slotLabel } from '@/lib/quroosh/guests';
import { internationalPhone } from '@/lib/quroosh/phones';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * A guest books their slot from their invitation link (Quroosh 0005).
 *
 * No account: the link's token is the key, and `book_slot()` is the only
 * write it reaches. The phones are built here from the country picked and
 * the number typed (E.164, phones.ts). The database decides the rest in one
 * step: the invitation is not cancelled or already booked, the slot is on,
 * not started and in the same project, and it is free. Two guests choosing
 * the same slot race on its unique index; the second gets `slot_taken`.
 * Refusals come back with a hint the form translates.
 *
 * On success the slot's day and time come back, on the club's clock, for
 * the confirmation.
 */
export async function bookAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  // A field no person sees; anything in it means a bot filled the form.
  // Answer as if it worked, so the bot learns nothing.
  if (String(formData.get('website') ?? '') !== '') return ok('booked');

  const token = String(formData.get('token') ?? '');
  const locale = formData.get('locale') === 'en' ? 'en' : 'ar';
  if (!isToken(token) || !isQurooshConfigured()) return fail('This invitation does not exist.', 'not_found');

  const slotId = String(formData.get('slot_id') ?? '');
  if (!UUID.test(slotId)) return fail('Choose a time.', 'slot_missing');

  const phone = internationalPhone(String(formData.get('phone_country') ?? ''), String(formData.get('phone') ?? ''));
  if (!phone) return fail('The mobile number is not valid.', 'phone_invalid');

  const answer = formData.get('needs_transport');
  if (answer !== 'yes' && answer !== 'no') return fail('Say whether you need transport.', 'transport_missing');
  const needsTransport = answer === 'yes';

  let transportPhone: string | null = null;
  if (needsTransport) {
    const typed = String(formData.get('transport_phone') ?? '');
    if (typed.trim() === '') return fail('Give the number of your driver or office manager.', 'transport_phone_missing');
    transportPhone = internationalPhone(String(formData.get('transport_phone_country') ?? ''), typed);
    if (!transportPhone) return fail('That number is not valid.', 'transport_phone_invalid');
  }

  const { data: startsAt, error } = await createQurooshClient().rpc('book_slot', {
    p_token: token,
    p_slot: slotId,
    p_phone: phone,
    p_needs_transport: needsTransport,
    p_transport_phone: transportPhone,
  });
  if (error) {
    const result = fromPostgrest(error);
    // Anything the database refused without naming why is "check your answers".
    return result.hint ? result : { ...result, hint: 'invalid' };
  }
  return ok('booked', typeof startsAt === 'string' ? slotLabel(startsAt, locale) : undefined);
}
