/**
 * The Quroosh application, question by question, in the order the form asks
 * them (the club's "أسئلة التسجيل في قروش 2026", with the 2026-11-07 changes;
 * see supabase/quroosh/migrations). One list drives the public form, the server action
 * and the managers' view, so a question is added in one place.
 *
 * `name` is the column in the Quroosh database's `applications`; the wording lives in the
 * catalogs under `quroosh.apply.q.<name>` (question), `quroosh.apply.hint.<name>`
 * (help line, optional) and `quroosh.apply.options.<name>.<value>` (choices).
 * The option values must match the CHECK constraints in supabase/quroosh/migrations.
 */

export type QuestionKind =
  | 'text' // one line
  | 'email'
  | 'tel'
  | 'url'
  | 'number' // a whole number between `min` and `max`
  | 'textarea' // several lines
  | 'radio' // one of `options`
  | 'select' // one of `options`, as a drop-down
  | 'checkboxes' // several of `options`
  | 'yesno' // a boolean, asked as two labelled choices
  | 'consent'; // a boolean that must be ticked

export type Question = {
  name: string;
  kind: QuestionKind;
  required: boolean;
  options?: readonly string[];
  /** Longest answer for text kinds, largest value for `number` (the CHECK has the same). */
  max?: number;
  /** Smallest value, for `number`. */
  min?: number;
};

export type Section = { key: string; questions: Question[] };

export const SECTIONS: Section[] = [
  {
    key: 'founder',
    questions: [
      { name: 'founder_name', kind: 'text', required: true, max: 200 },
      { name: 'email', kind: 'email', required: true, max: 320 },
      { name: 'phone', kind: 'tel', required: true },
      {
        name: 'university_relation',
        kind: 'radio',
        required: false,
        options: ['current_student', 'postgraduate', 'graduate', 'left_university', 'no_university', 'faculty'],
      },
      { name: 'university', kind: 'text', required: true, max: 200 },
      { name: 'age_band', kind: 'radio', required: true, options: ['under_18', '18_30', 'over_30'] },
    ],
  },
  {
    key: 'startup',
    questions: [
      { name: 'stage', kind: 'radio', required: true, options: ['idea', 'prototype', 'users', 'paying', 'recurring'] },
      { name: 'commitment', kind: 'radio', required: true, options: ['all_days', 'limited_conflict', 'cannot'] },
      { name: 'venture_name', kind: 'text', required: true, max: 200 },
      { name: 'problem', kind: 'textarea', required: true, max: 2000 },
      { name: 'pitch', kind: 'textarea', required: true, max: 3000 },
      {
        name: 'sector',
        kind: 'radio',
        required: true,
        options: ['fintech', 'health', 'education', 'tourism', 'energy', 'industry', 'retail', 'housing', 'agriculture', 'none'],
      },
    ],
  },
  {
    key: 'team',
    questions: [
      // The other members are asked under this one when the answer is yes.
      { name: 'has_team', kind: 'yesno', required: true },
      // Quroosh 0002: the lead founder counts; no more than the founder and
      // the members named (apply() checks the same).
      { name: 'attendees', kind: 'number', required: true, min: 1, max: 11 },
      { name: 'team_experience', kind: 'textarea', required: false, max: 3000 },
    ],
  },
  {
    key: 'market',
    questions: [
      { name: 'link_url', kind: 'url', required: false, max: 1000 },
      { name: 'customer', kind: 'textarea', required: true, max: 2000 },
      { name: 'customer_problem', kind: 'textarea', required: true, max: 3000 },
      { name: 'competitor', kind: 'textarea', required: true, max: 2000 },
      { name: 'evidence', kind: 'textarea', required: true, max: 3000 },
      { name: 'research', kind: 'textarea', required: true, max: 3000 },
      { name: 'revenue_model', kind: 'textarea', required: true, max: 2000 },
      {
        name: 'funding',
        kind: 'checkboxes',
        required: true,
        options: ['none', 'founders_family', 'grant', 'investors_under_1m', 'investors_1m_plus'],
      },
    ],
  },
  {
    key: 'quroosh',
    questions: [
      {
        name: 'wants',
        kind: 'checkboxes',
        required: true,
        options: ['investor_prep', 'customers_pilot', 'partners_suppliers', 'non_dilutive', 'go_to_market', 'exposure'],
      },
      {
        name: 'heard_from',
        kind: 'select',
        required: true,
        options: ['social', 'event', 'whatsapp', 'creator', 'referral', 'search', 'partner', 'other', 'university'],
      },
      { name: 'conflict_of_interest', kind: 'yesno', required: true },
    ],
  },
  {
    key: 'consent',
    questions: [
      { name: 'declaration', kind: 'consent', required: true },
      { name: 'data_consent', kind: 'consent', required: true },
      // Required since 2026-11-07: an answer either way, not a yes.
      { name: 'filming_consent', kind: 'yesno', required: true },
    ],
  },
];

export const QUESTIONS: Question[] = SECTIONS.flatMap((section) => section.questions);

/** `wants`: at most this many. */
export const MAX_WANTS = 2;
/** `funding`: this one excludes the others. */
export const FUNDING_NONE = 'none';
/** Other team members, besides the lead founder (apply() in the Quroosh database has the same cap). */
export const MAX_MEMBERS = 10;

/**
 * Saudi mobile numbers to +9665XXXXXXXX, as `app.normalize_phone` (0022) does;
 * null when the input is not one. The database normalises again; this only
 * lets the form say which field is wrong before sending.
 */
export function normalizeSaudiMobile(raw: string): string | null {
  const v = raw.replace(/[^0-9+]/g, '');
  if (/^\+9665[0-9]{8}$/.test(v)) return v;
  if (/^009665[0-9]{8}$/.test(v)) return `+${v.slice(2)}`;
  if (/^9665[0-9]{8}$/.test(v)) return `+${v}`;
  if (/^05[0-9]{8}$/.test(v)) return `+966${v.slice(1)}`;
  if (/^5[0-9]{8}$/.test(v)) return `+966${v}`;
  return null;
}
