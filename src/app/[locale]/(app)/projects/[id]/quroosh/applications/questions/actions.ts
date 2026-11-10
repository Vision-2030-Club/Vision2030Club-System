'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { fail, fromPostgrest, ok, requiredText, type ActionResult } from '@/lib/actions';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { kickApplicationSheetSync } from '@/lib/quroosh/applicationSheet';
import {
  ADDABLE_KINDS,
  ADDED_MAX_LENGTH,
  CHOICE_KINDS,
  SORT_STEP,
  toRow,
  type FormOption,
  type FormQuestion,
  type Wording,
} from '@/lib/quroosh/form';
import { loadForm } from '@/lib/quroosh/loadForm';
import { SECTION_KEYS, type QuestionKind, type SectionKey } from '@/lib/quroosh/questions';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * The managers' edits to a project's application form (Quroosh 0004): add a
 * question, edit one (wording in both languages, help line, required, the
 * choices, the section), hide or show it, move it up or down. There is no
 * delete, for questions or for choices: they are hidden, so every past
 * answer keeps its question and its label.
 *
 * The club database answers whether this person manages the project
 * (getQurooshAccess); only then is the Quroosh database written
 * (`save_questions`), recording who. After every edit the project's Google
 * Sheet is rewritten in the new wording (kickApplicationSheetSync).
 */

const MAX_LABEL = 1000;
const MAX_HINT = 2000;
const MAX_OPTIONS = 50;

type Context = { projectId: string; locale: string; actor: string; form: FormQuestion[] };

async function context(formData: FormData): Promise<Context | ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const access = await getQurooshAccess(projectId);
  if (!access || !can.manage(access.role)) return fail('Only the project’s managers can change this.', 'forbidden');
  if (!isQurooshConfigured()) return fail('The Quroosh database is not configured on this deployment.');
  const { form, editable } = await loadForm(createQurooshClient(), projectId);
  if (!editable) return fail('Editing the questions needs Quroosh migration 0004.', 'not_ready');
  return { projectId, locale, actor: access.me.id, form };
}

async function save(ctx: Context, questions: FormQuestion[]): Promise<ActionResult> {
  const { error } = await createQurooshClient().rpc('save_questions', {
    p_project: ctx.projectId,
    p_actor: ctx.actor,
    p_questions: questions.map(toRow),
  });
  if (error) return fromPostgrest(error);
  revalidatePath(`/${ctx.locale}/projects/${ctx.projectId}/quroosh/applications`, 'layout');
  revalidatePath(`/${ctx.locale}/quroosh/apply/${ctx.projectId}`);
  kickApplicationSheetSync(ctx.projectId);
  return ok();
}

function words(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v === '' ? null : v.slice(0, max);
}

function wording(value: unknown, max: number): Wording {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return { en: words(o.en, max), ar: words(o.ar, max) };
}

function int(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && Math.abs(n) <= 1_000_000_000 ? n : NaN;
}

function lastOrder(form: FormQuestion[], section: SectionKey, except?: string): number {
  return Math.max(0, ...form.filter((q) => q.section === section && q.key !== except).map((q) => q.sortOrder));
}

/**
 * The choices as posted, merged over the question's own: every choice it had
 * stays (posted wording and hidden flag, else as it was), new ones get a
 * value of their own. A choice is never removed.
 */
function mergeOptions(existing: FormOption[], posted: unknown, builtin: boolean): FormOption[] | string {
  const list = Array.isArray(posted) ? posted : [];
  const byValue = new Map(existing.map((o) => [o.value, o]));
  const added: FormOption[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const text = wording(o, MAX_LABEL);
    const value = typeof o.value === 'string' ? o.value : '';
    const old = byValue.get(value);
    if (old) {
      byValue.set(value, { ...old, ...text, hidden: o.hidden === true });
      // An added question's choice keeps wording of its own.
      if (!builtin && !text.en && !text.ar) return 'label_missing';
    } else {
      if (!text.en && !text.ar) continue; // an empty new row: ignored
      added.push({ value: `o_${randomUUID().replace(/-/g, '').slice(0, 8)}`, ...text, hidden: o.hidden === true });
    }
  }
  const all = [...existing.map((o) => byValue.get(o.value) ?? o), ...added];
  return all.length > MAX_OPTIONS ? 'invalid' : all;
}

/** Adds a question (no key) or saves one (its key). The question comes as JSON, as the editor holds it. */
export async function saveQuestionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await context(formData);
  if ('ok' in ctx) return ctx;

  let posted: Record<string, unknown>;
  try {
    posted = JSON.parse(String(formData.get('question') ?? '{}')) as Record<string, unknown>;
  } catch {
    return fail('The question could not be read.', 'invalid');
  }

  const key = typeof posted.key === 'string' ? posted.key : '';
  const existing = key ? ctx.form.find((q) => q.key === key) : undefined;
  if (key && !existing) return fail('This question does not exist.', 'invalid');

  const kind = (existing?.kind ?? posted.kind) as QuestionKind;
  if (!existing && !ADDABLE_KINDS.includes(kind)) return fail('Choose what kind of answer it takes.', 'invalid');
  const section = SECTION_KEYS.includes(posted.section as SectionKey)
    ? (posted.section as SectionKey)
    : (existing?.section ?? 'quroosh');

  const builtin = existing?.builtin ?? false;
  const locked = existing?.locked ?? false;
  const label = wording(posted.label, MAX_LABEL);
  if (!builtin && !label.en && !label.ar) return fail('Write the question in at least one language.', 'label_missing');

  const base: FormQuestion = existing ?? {
    key: `c_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
    section,
    kind,
    builtin: false,
    locked: false,
    required: false,
    hidden: false,
    label,
    hint: { en: null, ar: null },
    options:
      kind === 'yesno'
        ? [
            { value: 'yes', en: null, ar: null, hidden: false },
            { value: 'no', en: null, ar: null, hidden: false },
          ]
        : [],
    max: ADDED_MAX_LENGTH[kind],
    sortOrder: 0,
  };

  const question: FormQuestion = {
    ...base,
    section,
    label,
    hint: wording(posted.hint, MAX_HINT),
    required: locked ? base.required : posted.required === true,
    // Moving to another section puts it at that section's end.
    sortOrder:
      existing && existing.section === section ? existing.sortOrder : lastOrder(ctx.form, section, base.key) + SORT_STEP,
  };

  if (CHOICE_KINDS.has(kind) || kind === 'yesno') {
    const options =
      kind === 'yesno'
        ? mergeOptions(
            base.options,
            (Array.isArray(posted.options) ? posted.options : []).filter(
              (o: unknown) => o && typeof o === 'object' && ['yes', 'no'].includes(String((o as { value?: unknown }).value)),
            ),
            builtin,
          )
        : mergeOptions(base.options, posted.options, builtin);
    if (typeof options === 'string') return fail('Every choice needs wording in at least one language.', options);
    if (kind === 'yesno') options.forEach((o) => (o.hidden = false));
    if (CHOICE_KINDS.has(kind) && !options.some((o) => !o.hidden)) {
      return fail('A multiple-choice question needs at least one choice that is shown.', 'choices_missing');
    }
    question.options = options;
  }

  if (kind === 'checkboxes') {
    const max = int(posted.max);
    if (Number.isNaN(max) || (max !== undefined && max < 1)) return fail('The most choices must be 1 or more.', 'range_invalid');
    question.max = max;
  }
  if (kind === 'number' && !builtin) {
    const min = int(posted.min);
    const max = int(posted.max);
    if (Number.isNaN(min) || Number.isNaN(max) || (min !== undefined && max !== undefined && min > max)) {
      return fail('The smallest number must not be more than the largest.', 'range_invalid');
    }
    question.min = min;
    question.max = max;
  }

  return save(ctx, [question]);
}

/** Hides a question from the form, or shows it again. Its past answers stay either way. */
export async function setQuestionHiddenAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await context(formData);
  if ('ok' in ctx) return ctx;
  const question = ctx.form.find((q) => q.key === formData.get('key'));
  if (!question) return fail('This question does not exist.', 'invalid');
  if (question.locked) return fail('This question cannot be hidden.', 'locked');
  return save(ctx, [{ ...question, hidden: formData.get('hidden') === 'true' }]);
}

/** Moves a question one place up or down in its section; the section is renumbered. */
export async function moveQuestionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await context(formData);
  if ('ok' in ctx) return ctx;
  const question = ctx.form.find((q) => q.key === formData.get('key'));
  if (!question) return fail('This question does not exist.', 'invalid');
  const section = ctx.form.filter((q) => q.section === question.section);
  const from = section.indexOf(question);
  const to = formData.get('direction') === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= section.length) return ok();
  [section[from], section[to]] = [section[to], section[from]];
  return save(
    ctx,
    section.map((q, i) => ({ ...q, sortOrder: (i + 1) * SORT_STEP })),
  );
}
