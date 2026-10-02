import 'server-only';
import { all, text } from '@/lib/actions';
import type { ApplyField, ApplyFields } from './applyFields';

/**
 * The answers a submitted form carries, as submit_application reads them.
 * A question the edition does not ask is sent as null whatever the form
 * posted, so a hand-crafted request cannot fill a field nobody was asked.
 *
 * `missing` names the first required question left blank — the form marks
 * them `required`, but only the server's check counts.
 */
export function applicationPayload(
  formData: FormData,
  fields: ApplyFields,
  locale: 'ar' | 'en',
): { payload: Record<string, unknown>; missing: ApplyField | null } {
  const asked = (field: ApplyField) => fields[field] !== 'off';
  const answer = (field: ApplyField) => (asked(field) ? text(formData, field) : null);

  const university = answer('university');
  const answers: Record<ApplyField, string | null> = {
    phone: answer('phone'),
    university,
    level: answer('level'),
    major: answer('major'),
    college: answer('college'),
    gpa: answer('gpa'),
    english_level: answer('english_level'),
    is_club_member: answer('is_club_member'),
    why_first: answer('why_first'),
  };

  let missing: ApplyField | null = null;
  for (const [field, value] of Object.entries(answers) as [ApplyField, string | null][]) {
    if (fields[field] === 'required' && !value) {
      missing = field;
      break;
    }
  }
  const universityOther = university === 'other' ? text(formData, 'university_other') : null;
  if (!missing && university === 'other' && !universityOther) missing = 'university';

  return {
    missing,
    payload: {
      name: text(formData, 'name'),
      email: text(formData, 'email'),
      phone: answers.phone,
      is_club_member: answers.is_club_member === null ? null : answers.is_club_member === 'yes',
      university,
      university_other: universityOther,
      level: answers.level,
      college: answers.college,
      major: answers.major,
      gpa: answers.gpa,
      english_level: answers.english_level,
      why_first: answers.why_first,
      locale,
      preferences: all(formData, 'preference'),
    },
  };
}
