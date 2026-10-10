'use server';

import { redirect } from '@/i18n/navigation';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { removeCv, uploadCv } from '@/lib/interviews/cv';
import { normalisePhone } from '@/lib/interviews/phone';
import { applicationsByPhone } from '@/lib/interviews/queries';
import { findRoomByToken } from '@/lib/interviews/roomLinks';
import { isToken } from '@/lib/interviews/tokens';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';

/**
 * A student opening one assignment's candidate link (roomLinks.ts): name, phone,
 * email and a CV. They are found by their phone number alone (normalised,
 * applicationsByPhone): the email is NOT compared with the one they applied
 * with, a decision the club made on 2026-10-09 to keep the door simple. If HR
 * put that number on this assignment's accepted list (Rooms tab), they go
 * straight to their personal booking page, which offers only that
 * assignment's times; otherwise they are told they are not accepted yet. An
 * older per-company link checks acceptance for the company instead.
 *
 * Because a phone number alone opens the booking page, what is typed here
 * never overwrites what is on file: a name or email is filled in only while
 * the application has none (a number HR added that never applied), and a CV
 * replaces the one on file only when the typed email is the application's
 * own. Otherwise a new CV is added only while there is none.
 *
 * Those writes go straight to the row with the service role (no 0001–0004
 * function updates them), so the audit log records them as `system`.
 */
export async function roomLoginAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const token = requiredText(formData, 'room_token');
  const locale = text(formData, 'locale') === 'en' ? 'en' : 'ar';

  if (!isInterviewsConfigured()) return fail('Not available right now.', 'not_configured');
  if (!isToken(token)) return fail('This link is not recognised.', 'bad_link');
  const db = createInterviewsClient();

  const room = await findRoomByToken(db, token);
  if (!room) return fail('This link is not recognised.', 'bad_link');
  const { data: company } = await db
    .from('companies')
    .select('id, is_hidden')
    .eq('id', room.companyId)
    .eq('edition_id', room.editionId)
    .maybeSingle();
  if (!company || company.is_hidden) return fail('This room is no longer open.', 'closed');

  const name = text(formData, 'name');
  const email = text(formData, 'email')?.toLowerCase() ?? '';
  const phone = normalisePhone(text(formData, 'phone'));
  if (!name) return fail('Enter your name.', 'missing_name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Enter a valid email address.', 'invalid_email');
  if (!phone) return fail('Enter a phone number.', 'missing_phone');

  const match = (await applicationsByPhone(db, room.editionId)).get(phone);
  if (!match) return fail('No one has been added with that phone number.', 'no_match');
  const { data: application } = await db
    .from('applications')
    .select('id, name, email, personal_token, cv_path')
    .eq('id', match.id)
    .maybeSingle();
  if (!application) return fail('No one has been added with that phone number.', 'no_match');

  // An assignment's link: on that assignment's list (0014). An older
  // company link: accepted for the company.
  const { data: accepted } = room.sessionId
    ? await db
        .from('session_acceptances')
        .select('id')
        .eq('application_id', application.id)
        .eq('session_id', room.sessionId)
        .is('revoked_at', null)
        .maybeSingle()
    : await db
        .from('application_preferences')
        .select('id')
        .eq('application_id', application.id)
        .eq('company_id', room.companyId)
        .eq('decision', 'accepted')
        .maybeSingle();
  if (!accepted) return ok('notAccepted');

  // Only blanks are filled in. The email may already be another
  // application's (one per edition); then it simply stays empty.
  if (!application.name) await db.from('applications').update({ name }).eq('id', application.id);
  if (!application.email) await db.from('applications').update({ email }).eq('id', application.id);
  const ownsRecord = !application.email || String(application.email).toLowerCase() === email;

  const file = formData.get('cv');
  const newCv = file instanceof File && file.size > 0 ? file : null;
  const hasCv = Boolean(application.cv_path);
  if (newCv && (!hasCv || ownsRecord)) {
    const uploaded = await uploadCv(db, room.editionId, newCv);
    if ('error' in uploaded) return fail(uploaded.error, uploaded.error);
    const { error } = await db.from('applications').update({ cv_path: uploaded.path }).eq('id', application.id);
    if (error) {
      await removeCv(db, uploaded.path);
      return fail(error.message);
    }
    await removeCv(db, application.cv_path as string | null);
  } else if (!hasCv && !newCv) {
    return fail('Attach your CV as a PDF.', 'missing_cv');
  }

  return redirect({ href: `/interviews/s/${application.personal_token as string}`, locale });
}
