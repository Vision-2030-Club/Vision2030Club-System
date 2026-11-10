'use server';

import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { fail, fromPostgrest, ok, type ActionResult } from '@/lib/actions';
import { kickApplicationAppend } from '@/lib/quroosh/applicationSheet';
import type { FormQuestion } from '@/lib/quroosh/form';
import { loadForm } from '@/lib/quroosh/loadForm';
import { FUNDING_NONE, MAX_MEMBERS, normalizeSaudiMobile } from '@/lib/quroosh/questions';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * One answer from the form, as stored, or a refusal hint. Hidden questions
 * are never read: the form does not show them.
 */
function readAnswer(q: FormQuestion, formData: FormData): { value: unknown } | { hint: string } {
  const allowed = new Set(q.options.filter((o) => !o.hidden).map((o) => o.value));
  const raw = String(formData.get(q.key) ?? '').trim();

  switch (q.kind) {
    case 'checkboxes': {
      const values = [...new Set(formData.getAll(q.key).map(String))];
      if (values.some((v) => !allowed.has(v))) return { hint: 'invalid' };
      if (q.required && values.length === 0) {
        return { hint: q.key === 'funding' ? 'funding_missing' : q.key === 'wants' ? 'wants_missing' : 'choices_missing' };
      }
      if (q.max !== undefined && values.length > q.max) return { hint: 'invalid' };
      if (q.key === 'funding' && values.includes(FUNDING_NONE) && values.length > 1) return { hint: 'invalid' };
      return { value: values.length > 0 ? values : null };
    }
    case 'yesno': {
      if (raw === '') return q.required ? { hint: 'invalid' } : { value: null };
      if (raw !== 'yes' && raw !== 'no') return { hint: 'invalid' };
      return { value: raw === 'yes' };
    }
    case 'consent': {
      const ticked = formData.get(q.key) === 'on';
      if (q.required && !ticked) return { hint: 'invalid' };
      return { value: ticked };
    }
    case 'number': {
      if (raw === '') return q.required ? { hint: 'invalid' } : { value: null };
      if (!/^[0-9]+$/.test(raw)) return { hint: 'invalid' };
      const n = Number(raw);
      if ((q.min !== undefined && n < q.min) || (q.max !== undefined && n > q.max)) return { hint: 'invalid' };
      return { value: n };
    }
    case 'radio':
    case 'select': {
      if (raw === '') return q.required ? { hint: 'invalid' } : { value: null };
      if (!allowed.has(raw)) return { hint: 'invalid' };
      return { value: raw };
    }
    default: {
      if (raw === '') return q.required ? { hint: 'invalid' } : { value: null };
      if (q.max !== undefined && raw.length > q.max) return { hint: 'invalid' };
      if (q.kind === 'email' && !EMAIL.test(raw)) return { hint: 'invalid' };
      if (q.kind === 'url' && !/^https?:\/\//.test(raw)) return { hint: 'invalid' };
      if (q.kind === 'tel') {
        // The founder's phone is normalised by the database; an added one here.
        const phone = normalizeSaudiMobile(raw);
        if (!phone) return { hint: 'phone_invalid' };
        return { value: q.builtin ? raw : phone };
      }
      return { value: raw };
    }
  }
}

/**
 * Submits a Quroosh application from the public form.
 *
 * The answers are checked against the project's questions as its managers
 * edited them (Quroosh 0004: which are shown, which are required, which
 * choices are offered), then sent to the Quroosh database's `apply()`
 * (supabase/quroosh): the form's own questions by column, the added ones
 * under `answers`. The database checks the shapes (phones, emails, lengths,
 * one application per phone, the team) and whether the form is open.
 * Refusals come back with a hint the form translates.
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
  if (!isQurooshConfigured()) return fail('Quroosh is not configured.', 'not_found');

  const db = createQurooshClient();
  const { form, editable } = await loadForm(db, projectId);

  const application: Record<string, unknown> = {};
  const answers: Record<string, unknown> = {};
  for (const question of form) {
    if (question.hidden) continue;
    const result = readAnswer(question, formData);
    if ('hint' in result) return fail('Some answers are missing or not valid.', result.hint);
    if (question.builtin) application[question.key] = result.value;
    else if (result.value !== null) answers[question.key] = result.value;
  }
  // Before Quroosh 0004 there is no `answers` column (and no added questions).
  if (editable) application.answers = answers;

  const names = formData.getAll('member_name').map((v) => String(v).trim());
  const phones = formData.getAll('member_phone').map((v) => String(v).trim());
  const emails = formData.getAll('member_email').map((v) => String(v).trim());
  const members =
    application.has_team === true
      ? names.slice(0, MAX_MEMBERS + 1).map((name, i) => ({ name, phone: phones[i] ?? '', email: emails[i] ?? '' }))
      : [];

  const { data: applicationId, error } = await db.rpc('apply', {
    p_project: projectId,
    p_application: application,
    p_members: members,
  });
  if (error) {
    const result = fromPostgrest(error);
    // Anything the database refused without naming why is "check your answers".
    return result.hint ? result : { ...result, hint: 'invalid' };
  }
  // A row in the project's Google Sheet, after the founder has their answer.
  if (typeof applicationId === 'string') kickApplicationAppend(projectId, applicationId);
  return ok('applied');
}
