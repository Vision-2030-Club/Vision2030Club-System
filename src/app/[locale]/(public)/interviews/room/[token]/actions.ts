'use server';

import { redirect } from '@/i18n/navigation';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { removeCv, uploadCv } from '@/lib/interviews/cv';
import { normalisePhone } from '@/lib/interviews/phone';
import { findRoomByToken } from '@/lib/interviews/roomLinks';
import { isToken } from '@/lib/interviews/tokens';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';

/**
 * A student opening one room's link (roomLinks.ts): name, phone, the email
 * they applied with, and a CV. The email and phone together must belong to
 * one application in this edition: phone alone is not enough, because anyone
 * who knows a classmate's number could otherwise open their booking page
 * (the rule .claude/rules/interviews.md keeps). If HR accepted them for this
 * room's company (the Rooms tab's phone list, or Accept on their applicant
 * page), they go straight to their personal booking page; otherwise they are
 * told they are not accepted yet.
 *
 * The CV: a new one replaces the one on file; none is needed if one is
 * already there. It is written straight to the row with the service role
 * (no 0001–0004 function updates only a CV), so the audit log records that
 * change as `system`.
 *
 * Nothing here needs 0005: the link is kept in the edition's settings, the
 * matching is done here, and booking is the personal page from 0002.
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

  const { data: application } = await db
    .from('applications')
    .select('id, phone, personal_token, cv_path')
    .eq('edition_id', room.editionId)
    .eq('email', email)
    .maybeSingle();
  if (!application || normalisePhone(application.phone as string | null) !== phone) {
    return fail('No application matches that phone and email.', 'no_match');
  }

  const { data: accepted } = await db
    .from('application_preferences')
    .select('id')
    .eq('application_id', application.id)
    .eq('company_id', room.companyId)
    .eq('decision', 'accepted')
    .maybeSingle();
  if (!accepted) return ok('notAccepted');

  const file = formData.get('cv');
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadCv(db, room.editionId, file);
    if ('error' in uploaded) return fail(uploaded.error, uploaded.error);
    const { error } = await db.from('applications').update({ cv_path: uploaded.path }).eq('id', application.id);
    if (error) {
      await removeCv(db, uploaded.path);
      return fail(error.message);
    }
    await removeCv(db, application.cv_path as string | null);
  } else if (!application.cv_path) {
    return fail('Attach your CV as a PDF.', 'missing_cv');
  }

  return redirect({ href: `/interviews/s/${application.personal_token as string}`, locale });
}
