'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { newToken } from '@/lib/interviews/tokens';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * The managers' side of the booths' challenges (Quroosh 0008): make and
 * change a challenge, write its questions, hide one.
 *
 * The club database answers whether this person manages the project
 * (getQurooshAccess) before the Quroosh database is touched, and every
 * function is given the project so one project cannot reach another's.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function refusal(locale: string, hint: string, message: string): Promise<ActionResult> {
  const t = await getTranslations({ locale, namespace: 'quroosh.challenges.errors' });
  return fail(t.has(hint) ? t(hint) : message, hint);
}

async function managerOf(formData: FormData): Promise<{ projectId: string; locale: string } | ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const access = await getQurooshAccess(projectId);
  if (!access || !can.manage(access.role)) {
    return refusal(locale, 'forbidden', 'Only the project’s managers can do this.');
  }
  if (!isQurooshConfigured()) return refusal(locale, 'not_configured', 'The Quroosh database is not configured.');
  return { projectId, locale };
}

/** A whole number from a form field within a range, or null. */
function whole(formData: FormData, key: string, min: number, max: number): number | null {
  const raw = text(formData, key) ?? '';
  if (!/^[0-9]{1,7}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

/**
 * Makes a challenge, then opens it so its questions can be written; or
 * saves the changes to one. A new challenge gets the code its QR will hold.
 */
export async function saveChallengeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerOf(formData);
  if ('ok' in ctx) return ctx;

  const id = text(formData, 'challenge_id');
  const booth = text(formData, 'booth');
  const topic = text(formData, 'topic');
  const day = text(formData, 'day');
  const seconds = whole(formData, 'seconds', 5, 120);
  const maxPoints = whole(formData, 'max_points', 0, 1_000_000);
  if (id && !UUID.test(id)) return refusal(ctx.locale, 'not_found', 'This challenge does not exist.');
  if (!booth || booth.length > 120) return refusal(ctx.locale, 'booth_invalid', 'Write the booth’s name.');
  if (topic && topic.length > 200) return refusal(ctx.locale, 'topic_invalid', 'The topic is too long.');
  if (day && !DAY.test(day)) return refusal(ctx.locale, 'day_invalid', 'Choose a day.');
  if (seconds === null) return refusal(ctx.locale, 'seconds_invalid', 'Seconds must be between 5 and 120.');
  if (maxPoints === null) return refusal(ctx.locale, 'points_invalid', 'Quroosh must be between 0 and 1,000,000.');

  const { data: savedId, error } = await createQurooshClient().rpc('challenge_save', {
    p_project: ctx.projectId,
    p_id: id || null,
    p_token: id ? null : newToken(),
    p_booth: booth,
    p_topic: topic,
    p_day: day || null,
    p_seconds: seconds,
    p_max_points: maxPoints,
    // A new challenge starts switched on; an existing one follows its checkbox.
    p_active: id ? formData.get('active') === 'on' : true,
  });
  if (error || typeof savedId !== 'string') {
    return refusal(ctx.locale, error?.hint ?? 'invalid', error?.message ?? 'The challenge could not be saved.');
  }

  const base = `/projects/${ctx.projectId}/quroosh/challenges`;
  revalidatePath(`/${ctx.locale}${base}`);
  if (!id) {
    // Outside any try: redirect() works by throwing.
    redirect({ href: `${base}/${savedId}`, locale: ctx.locale });
  }
  revalidatePath(`/${ctx.locale}${base}/${savedId}`);
  return ok();
}

/** Adds a question to a challenge, or rewrites one. Empty option fields are left out. */
export async function saveQuestionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerOf(formData);
  if ('ok' in ctx) return ctx;

  const challengeId = text(formData, 'challenge_id') ?? '';
  const questionId = text(formData, 'question_id');
  if (!UUID.test(challengeId) || (questionId && !UUID.test(questionId))) {
    return refusal(ctx.locale, 'not_found', 'This challenge does not exist.');
  }
  const prompt = text(formData, 'prompt');
  if (!prompt || prompt.length > 500) return refusal(ctx.locale, 'prompt_invalid', 'Write the question.');

  // The right option is chosen by its field; it must be one that was filled.
  const fields = [0, 1, 2, 3].map((index) => text(formData, `option_${index}`));
  if (fields.some((option) => option && option.length > 200)) {
    return refusal(ctx.locale, 'options_invalid', 'An option is too long.');
  }
  const chosen = whole(formData, 'correct', 0, 3);
  const options = fields.filter((option): option is string => Boolean(option));
  if (options.length < 2) return refusal(ctx.locale, 'options_invalid', 'Write at least two options.');
  if (chosen === null || !fields[chosen]) {
    return refusal(ctx.locale, 'correct_invalid', 'Choose which option is right.');
  }
  const correct = fields.slice(0, chosen).filter(Boolean).length;

  const { error } = await createQurooshClient().rpc('challenge_question_save', {
    p_project: ctx.projectId,
    p_challenge: challengeId,
    p_id: questionId || null,
    p_prompt: prompt,
    p_options: options,
    p_correct: correct,
  });
  if (error) return refusal(ctx.locale, error.hint ?? 'invalid', error.message);
  revalidatePath(`/${ctx.locale}/projects/${ctx.projectId}/quroosh/challenges/${challengeId}`);
  return ok();
}

/** Hides a question from new attempts, or shows it again. Its answers stay. */
export async function hideQuestionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await managerOf(formData);
  if ('ok' in ctx) return ctx;
  const challengeId = text(formData, 'challenge_id') ?? '';
  const questionId = text(formData, 'question_id') ?? '';
  if (!UUID.test(challengeId) || !UUID.test(questionId)) {
    return refusal(ctx.locale, 'not_found', 'This question does not exist.');
  }
  const { error } = await createQurooshClient().rpc('challenge_question_hide', {
    p_project: ctx.projectId,
    p_question: questionId,
    p_hidden: formData.get('hidden') === 'true',
  });
  if (error) return refusal(ctx.locale, error.hint ?? 'invalid', error.message);
  revalidatePath(`/${ctx.locale}/projects/${ctx.projectId}/quroosh/challenges/${challengeId}`);
  return ok();
}
