/**
 * A project's application form as its managers have edited it (Quroosh 0004).
 *
 * The form starts as the list in questions.ts (SECTIONS). A manager's edits
 * are rows of the Quroosh database's `questions` table: a row whose key is
 * one of the form's own questions changes it (wording, help line, required,
 * hidden, choices, section, order); any other row is a question a manager
 * added. `buildForm` merges the two. Nothing is ever removed: questions and
 * choices are hidden, so a past answer always has its question and its label.
 *
 * Answers are stored by question key and choice value, never by wording, so
 * an edit to the wording changes every past application as it is shown.
 *
 * Pure and client-safe: no database access here (see loadForm.ts).
 */
import { QUESTIONS, SECTIONS, SECTION_KEYS, type QuestionKind, type SectionKey } from './questions';

export type Wording = { en: string | null; ar: string | null };

export type FormOption = { value: string; hidden: boolean } & Wording;

export type FormQuestion = {
  key: string;
  section: SectionKey;
  kind: QuestionKind;
  /** One of the form's own questions (a column of `applications`), not one a manager added. */
  builtin: boolean;
  /** Cannot be hidden or made optional: the lead founder's contact and the data consent. */
  locked: boolean;
  required: boolean;
  hidden: boolean;
  /** A manager's wording; null in a language means the catalog's (own questions) or the other language's (added ones). */
  label: Wording;
  /** The help line; for a consent question, the statement that is ticked. */
  hint: Wording;
  /** Choices, for radio, select and checkboxes; for yesno, its two labels (`yes`, `no`). */
  options: FormOption[];
  /** number: smallest value. */
  min?: number;
  /** number: largest value; text kinds: longest answer; checkboxes: most choices. */
  max?: number;
  sortOrder: number;
};

/** A row of the Quroosh database's `questions` (0004). */
export type QuestionRow = {
  key: string;
  section: string;
  sort_order: number;
  kind: string;
  builtin: boolean;
  required: boolean;
  hidden: boolean;
  label_en: string | null;
  label_ar: string | null;
  hint_en: string | null;
  hint_ar: string | null;
  options: unknown;
  min_value: number | null;
  max_value: number | null;
};

/** The form's own questions that cannot be hidden or made optional. */
export const LOCKED_KEYS: ReadonlySet<string> = new Set(['founder_name', 'email', 'phone', 'data_consent']);

/** Kinds a manager may give a question they add. */
export const ADDABLE_KINDS: readonly QuestionKind[] = [
  'text',
  'textarea',
  'number',
  'email',
  'tel',
  'url',
  'radio',
  'select',
  'checkboxes',
  'yesno',
  'consent',
];

export const CHOICE_KINDS: ReadonlySet<QuestionKind> = new Set(['radio', 'select', 'checkboxes']);

/** Longest answer to an added question, by kind (the form's own keep the lengths of their columns). */
export const ADDED_MAX_LENGTH: Partial<Record<QuestionKind, number>> = {
  text: 500,
  textarea: 3000,
  email: 320,
  url: 1000,
};

/** Room between sort orders, so one question can move without renumbering a section. */
export const SORT_STEP = 10;

const YES_NO = ['yes', 'no'];

function asOptions(value: unknown): FormOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const o = item as Record<string, unknown>;
    if (typeof o.value !== 'string' || o.value === '') return [];
    const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    return [{ value: o.value, en: text(o.en), ar: text(o.ar), hidden: o.hidden === true }];
  });
}

function isSection(value: string): value is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(value);
}

function isKind(value: string): value is QuestionKind {
  return (ADDABLE_KINDS as readonly string[]).includes(value);
}

/** The form's own question `key`, before any edit. */
function defaultQuestion(sectionKey: SectionKey, index: number, q: (typeof QUESTIONS)[number]): FormQuestion {
  const values = q.kind === 'yesno' ? YES_NO : (q.options ?? []);
  return {
    key: q.name,
    section: sectionKey,
    kind: q.kind,
    builtin: true,
    locked: LOCKED_KEYS.has(q.name),
    required: q.required,
    hidden: false,
    label: { en: null, ar: null },
    hint: { en: null, ar: null },
    options: values.map((value) => ({ value, en: null, ar: null, hidden: false })),
    min: q.min,
    max: q.max,
    sortOrder: (index + 1) * SORT_STEP,
  };
}

/**
 * The project's form: the form's own questions with the managers' edits
 * merged over them, then the questions they added, in section and sort
 * order. Hidden questions are included (flagged); callers decide.
 */
export function buildForm(rows: QuestionRow[]): FormQuestion[] {
  const byKey = new Map<string, FormQuestion>();
  SECTIONS.forEach((section) =>
    section.questions.forEach((q, index) => byKey.set(q.name, defaultQuestion(section.key, index, q))),
  );

  for (const row of rows) {
    const base = byKey.get(row.key);
    const section = isSection(row.section) ? row.section : (base?.section ?? 'quroosh');
    const label = { en: row.label_en, ar: row.label_ar };
    const hint = { en: row.hint_en, ar: row.hint_ar };
    const saved = asOptions(row.options);

    if (base) {
      // One of the form's own: its kind, lengths and range are its column's.
      const savedByValue = new Map(saved.map((o) => [o.value, o]));
      const own = base.options.map((o) => {
        const s = savedByValue.get(o.value);
        // yesno's two answers are never hidden.
        return s ? { ...s, hidden: base.kind === 'yesno' ? false : s.hidden } : o;
      });
      // Choices a manager added to it, after its own, in the order saved.
      const added = base.kind === 'yesno' ? [] : saved.filter((o) => !base.options.some((b) => b.value === o.value));
      byKey.set(row.key, {
        ...base,
        section,
        sortOrder: row.sort_order,
        required: base.locked ? base.required : row.required,
        hidden: base.locked ? false : row.hidden,
        label,
        hint,
        options: [...own, ...added],
        max: base.kind === 'checkboxes' ? (row.max_value ?? undefined) : base.max,
      });
      continue;
    }

    if (row.builtin || !isKind(row.kind)) continue; // a question no longer in the code: nothing to show it with
    const kind = row.kind;
    byKey.set(row.key, {
      key: row.key,
      section,
      kind,
      builtin: false,
      locked: false,
      required: row.required,
      hidden: row.hidden,
      label,
      hint,
      options:
        kind === 'yesno'
          ? YES_NO.map((value) => saved.find((o) => o.value === value) ?? { value, en: null, ar: null, hidden: false })
          : CHOICE_KINDS.has(kind)
            ? saved
            : [],
      min: kind === 'number' ? (row.min_value ?? undefined) : undefined,
      max: kind === 'number' || kind === 'checkboxes' ? (row.max_value ?? undefined) : ADDED_MAX_LENGTH[kind],
      sortOrder: row.sort_order,
    });
  }

  const sectionIndex = (s: SectionKey) => SECTION_KEYS.indexOf(s);
  return [...byKey.values()].sort(
    (a, b) =>
      sectionIndex(a.section) - sectionIndex(b.section) || a.sortOrder - b.sortOrder || a.key.localeCompare(b.key),
  );
}

/** The form as the code has it, for a deployment whose Quroosh database predates 0004. */
export const DEFAULT_FORM: FormQuestion[] = buildForm([]);

/** The row `save_questions` (0004) stores for a question. */
export function toRow(q: FormQuestion): Record<string, unknown> {
  return {
    key: q.key,
    section: q.section,
    sort_order: q.sortOrder,
    kind: q.kind,
    builtin: q.builtin,
    required: q.required,
    hidden: q.hidden,
    label_en: q.label.en,
    label_ar: q.label.ar,
    hint_en: q.hint.en,
    hint_ar: q.hint.ar,
    options: q.options,
    min: q.kind === 'number' ? (q.min ?? null) : null,
    max: q.kind === 'number' || q.kind === 'checkboxes' ? (q.max ?? null) : null,
  };
}

// -----------------------------------------------------------------------------
// Wording
// -----------------------------------------------------------------------------

/** Looks a key up under `quroosh.apply` in one language's catalog; null when it has none. */
export type Catalog = (key: string) => string | null;

export type Locale = 'en' | 'ar';

export const asLocale = (locale: string): Locale => (locale === 'ar' ? 'ar' : 'en');

function other(locale: Locale): Locale {
  return locale === 'ar' ? 'en' : 'ar';
}

/** A manager's wording in this language, else the catalog's, else theirs in the other language. */
function pick(own: Wording, locale: Locale, catalogKey: string | null, catalog: Catalog): string | null {
  return own[locale] ?? (catalogKey ? catalog(catalogKey) : null) ?? own[other(locale)];
}

export function questionLabel(q: FormQuestion, locale: Locale, catalog: Catalog): string {
  return pick(q.label, locale, q.builtin ? `q.${q.key}` : null, catalog) ?? q.key;
}

/** The help line; for a consent question, the statement ticked. Null when it has none. */
export function questionHint(q: FormQuestion, locale: Locale, catalog: Catalog): string | null {
  const key = q.builtin ? (q.kind === 'consent' ? `consent.${q.key}` : `hint.${q.key}`) : null;
  return pick(q.hint, locale, key, catalog);
}

export function optionLabel(q: FormQuestion, value: string, locale: Locale, catalog: Catalog): string {
  const option = q.options.find((o) => o.value === value);
  // An added yes/no question says the catalog's plain "Yes" and "No" (quroosh.apply.yes / .no).
  const catalogKey = q.builtin ? `options.${q.key}.${value}` : q.kind === 'yesno' ? value : null;
  return (option ? pick(option, locale, catalogKey, catalog) : catalogKey ? catalog(catalogKey) : null) ?? value;
}

// -----------------------------------------------------------------------------
// What the public form is given
// -----------------------------------------------------------------------------

/** A question as the public form draws it: its wording resolved, hidden choices left out. */
export type PublicQuestion = {
  key: string;
  kind: QuestionKind;
  required: boolean;
  label: string;
  hint: string | null;
  options: { value: string; label: string }[];
  min?: number;
  max?: number;
};

export type PublicSection = { key: SectionKey; title: string; questions: PublicQuestion[] };

/** The visible questions, by section, in one language. Empty sections are left out. */
export function publicSections(form: FormQuestion[], locale: Locale, catalog: Catalog): PublicSection[] {
  return SECTION_KEYS.flatMap((key) => {
    const questions = form
      .filter((q) => q.section === key && !q.hidden)
      .map((q) => ({
        key: q.key,
        kind: q.kind,
        required: q.required,
        label: questionLabel(q, locale, catalog),
        hint: questionHint(q, locale, catalog),
        options: q.options
          .filter((o) => !o.hidden)
          .map((o) => ({ value: o.value, label: optionLabel(q, o.value, locale, catalog) })),
        min: q.min,
        max: q.max,
      }));
    return questions.length > 0 ? [{ key, title: catalog(`sections.${key}`) ?? key, questions }] : [];
  });
}

/** An answer as stored: the form's own questions in their column, added ones under `answers`. */
export function answerOf(q: FormQuestion, row: Record<string, unknown>): unknown {
  if (q.builtin) return row[q.key];
  const answers = row.answers;
  return answers && typeof answers === 'object' ? (answers as Record<string, unknown>)[q.key] : undefined;
}

export function isEmptyAnswer(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/** A yes/no answer's choice value. */
export function yesNoValue(value: unknown): 'yes' | 'no' {
  return value === true || value === 'yes' ? 'yes' : 'no';
}
