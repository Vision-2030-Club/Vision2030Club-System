'use server';

import { ok, type ActionResult } from '@/lib/actions';
import { registerAttendee } from '@/lib/eventAttendance/api';
import { refusal } from '@/lib/eventAttendance/refusal';

/**
 * Signs a person up from the public form (0075). No account is needed: this
 * server registers them with the service role, and `event_register` checks
 * the project has the component and that sign-up is open.
 *
 * A new attendee gets their pass's token back, and the form opens the pass.
 * A mobile that is already registered gets no token: whoever typed the
 * number may not be its owner, so the pass is emailed again to the address
 * it was registered with, and the form says so.
 */
export async function joinAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  // A field no person sees; anything in it means a bot filled the form.
  // Answer as if it worked, so the bot learns nothing.
  if (String(formData.get('website') ?? '') !== '') return ok('already');

  const locale = String(formData.get('locale') ?? 'ar') === 'en' ? 'en' : 'ar';
  const email = String(formData.get('email') ?? '').trim();
  // Required here, though the database allows none: the pass goes by email.
  if (email === '') return refusal(locale, 'email_invalid', 'Write your email address.');

  const result = await registerAttendee({
    projectId: String(formData.get('project_id') ?? ''),
    name: String(formData.get('name') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    country: String(formData.get('phone_country') ?? ''),
    email,
    locale,
    source: 'form',
    requireOpen: true,
    sendPass: true,
  });
  if (!result.ok) return refusal(locale, result.hint, result.message);
  return result.created ? ok('registered', { token: result.token }) : ok('already');
}
