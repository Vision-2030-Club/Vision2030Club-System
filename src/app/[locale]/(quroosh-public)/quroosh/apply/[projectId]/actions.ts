'use server';

import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { fail, fromPostgrest, ok, type ActionResult } from '@/lib/actions';
import { MAX_MEMBERS, QUESTIONS } from '@/lib/quroosh/questions';

/**
 * Submits a Quroosh application from the public form.
 *
 * The answers go to the Quroosh database's `apply()` (supabase/quroosh) as
 * they were typed, keyed by column;
 * the database decides what is valid (required answers, the options, the
 * phone and email shapes, one application per phone) and whether the form
 * is open. Refusals come back with a hint the form translates.
 *
 * No account is needed. The call is made by this server with the Quroosh
 * database's secret key, and `apply()` is the only write it can reach from
 * here: it checks the form is open, and the project id comes from the page.
 */
export async function applyAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  // A field no person sees; anything in it means a bot filled the form.
  // Answer as if it worked, so the bot learns nothing.
  if (String(formData.get('website') ?? '') !== '') return ok('applied');

  const projectId = String(formData.get('project_id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return fail('Unknown form.', 'not_found');

  const application: Record<string, unknown> = {};
  for (const question of QUESTIONS) {
    const { name, kind } = question;
    if (kind === 'checkboxes') {
      application[name] = formData.getAll(name).map(String);
    } else if (kind === 'yesno') {
      const value = formData.get(name);
      application[name] = value === 'yes' ? true : value === 'no' ? false : null;
    } else if (kind === 'number') {
      const value = String(formData.get(name) ?? '').trim();
      application[name] = /^[0-9]+$/.test(value) ? Number(value) : null;
    } else if (kind === 'consent') {
      application[name] = formData.get(name) === 'on';
    } else {
      const value = String(formData.get(name) ?? '').trim();
      application[name] = value === '' ? null : value;
    }
  }

  const names = formData.getAll('member_name').map((v) => String(v).trim());
  const phones = formData.getAll('member_phone').map((v) => String(v).trim());
  const emails = formData.getAll('member_email').map((v) => String(v).trim());
  const members =
    application.has_team === true
      ? names.slice(0, MAX_MEMBERS + 1).map((name, i) => ({ name, phone: phones[i] ?? '', email: emails[i] ?? '' }))
      : [];

  if (!isQurooshConfigured()) return fail('Quroosh is not configured.', 'not_found');
  const { error } = await createQurooshClient().rpc('apply', {
    p_project: projectId,
    p_application: application,
    p_members: members,
  });
  if (error) {
    const result = fromPostgrest(error);
    // Anything the database refused without naming why is "check your answers".
    return result.hint ? result : { ...result, hint: 'invalid' };
  }
  return ok('applied');
}
