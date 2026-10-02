/**
 * Which questions the application form asks — chosen per edition by a
 * manager on the Applicants tab and kept in `editions.settings.apply_fields`
 * (read through edition_settings like every other setting; no column).
 *
 * Name, email, the companies and the CV are always asked: the database needs
 * the first two to know who applied, and the club decided every student sends
 * a CV. Everything else is off, optional or required. The defaults are the
 * questions the club asked for in October 2026; an edition that never saved
 * its own choice gets them.
 *
 * Shared by the forms (which fields to draw, which are `required`) and the
 * server actions (which answers to keep, which are missing), so the two never
 * disagree. No `server-only` here for that reason.
 */

export const APPLY_FIELDS = [
  'phone',
  'university',
  'level',
  'major',
  'college',
  'gpa',
  'english_level',
  'is_club_member',
  'why_first',
] as const;

export type ApplyField = (typeof APPLY_FIELDS)[number];

export const FIELD_MODES = ['off', 'optional', 'required'] as const;
export type FieldMode = (typeof FIELD_MODES)[number];

export type ApplyFields = Record<ApplyField, FieldMode>;

export const DEFAULT_APPLY_FIELDS: ApplyFields = {
  phone: 'required',
  university: 'required',
  level: 'required',
  major: 'required',
  college: 'off',
  gpa: 'off',
  english_level: 'off',
  is_club_member: 'off',
  why_first: 'off',
};

/** The edition's saved choice over the defaults, ignoring anything unrecognised. */
export function resolveApplyFields(saved: unknown): ApplyFields {
  const out: ApplyFields = { ...DEFAULT_APPLY_FIELDS };
  if (saved && typeof saved === 'object') {
    for (const field of APPLY_FIELDS) {
      const mode = (saved as Record<string, unknown>)[field];
      if (typeof mode === 'string' && (FIELD_MODES as readonly string[]).includes(mode)) {
        out[field] = mode as FieldMode;
      }
    }
  }
  return out;
}

/** The label key of each question in the `interviews` catalog. */
export const FIELD_LABELS: Record<ApplyField, string> = {
  phone: 'applicants.phone',
  university: 'applicants.university',
  level: 'applicants.level',
  major: 'applicants.major',
  college: 'applicants.college',
  gpa: 'applicants.gpa',
  english_level: 'applicants.english',
  is_club_member: 'applicants.clubMember',
  why_first: 'apply.whyFirst',
};
