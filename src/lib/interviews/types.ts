/**
 * Row shapes of the interviews database, as the pages read them. Kept in one
 * place so a column rename is one edit here and a type error everywhere it
 * matters.
 */

export type EditionStatus = 'draft' | 'active' | 'archived';

export type RatingLabel = { key: string; en: string; ar: string };

export type EditionSettings = {
  max_preferences: number;
  change_cutoff_hours: number;
  tv_call_minutes: number;
  feedback_email_mode: 'on_release' | 'immediately';
  rating_labels: RatingLabel[];
};

export type Edition = {
  id: string;
  name_en: string;
  name_ar: string;
  public_slug: string;
  club_project_id: string | null;
  status: EditionStatus;
  apply_opens_at: string | null;
  apply_closes_at: string | null;
  booking_opens_at: string | null;
  booking_closes_at: string | null;
  time_zone: string;
  tv_token: string | null;
  settings: Partial<EditionSettings>;
  created_at: string;
  updated_at: string;
};

export type Room = {
  id: string;
  edition_id: string;
  name: string;
  note: string | null;
  sort_order: number;
  is_active: boolean;
};

export type Company = {
  id: string;
  edition_id: string;
  name_en: string;
  name_ar: string;
  logo_url: string | null;
  desc_en: string | null;
  desc_ar: string | null;
  is_hidden: boolean;
  sort_order: number;
  access_token: string;
  access_pin: string | null;
  token_rotated_at: string | null;
};

export type Decision = 'pending' | 'accepted' | 'rejected';

export type Application = {
  id: string;
  edition_id: string;
  email: string;
  phone: string | null;
  name: string;
  is_club_member: boolean | null;
  university: string | null;
  university_other: string | null;
  level: string | null;
  college: string | null;
  major: string | null;
  gpa: string | null;
  english_level: string | null;
  why_first: string | null;
  locale: 'ar' | 'en';
  cv_path: string | null;
  cv_external_url: string | null;
  cv_import_ref: string | null;
  personal_token: string;
  source: 'form' | 'import';
  submitted_at: string;
  updated_at: string;
};

export type Preference = {
  id: string;
  application_id: string;
  company_id: string;
  rank: number;
  decision: Decision;
  decided_at: string | null;
  decision_note: string | null;
};

export type Session = {
  id: string;
  edition_id: string;
  company_id: string;
  room_id: string;
  day: string;
  starts_at: string;
  ends_at: string;
  slot_minutes: number;
};

export type Stage = 'scheduled' | 'arrived' | 'in_interview' | 'done' | 'no_show';

export const STAGES: Stage[] = ['scheduled', 'arrived', 'in_interview', 'done', 'no_show'];

/** A slot with whoever holds it — the `slot_status` view. */
export type SlotStatus = {
  id: string;
  edition_id: string;
  session_id: string;
  company_id: string;
  room_id: string;
  starts_at: string;
  ends_at: string;
  is_closed: boolean;
  booking_id: string | null;
  application_id: string | null;
  stage: Stage | null;
  arrived_at: string | null;
  stage_changed_at: string | null;
  student_name: string | null;
  student_phone: string | null;
};

export type Booking = {
  id: string;
  edition_id: string;
  slot_id: string;
  application_id: string;
  company_id: string;
  starts_at: string;
  ends_at: string;
  stage: Stage;
  arrived_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  stage_changed_at: string | null;
  stage_changed_by: string | null;
  booked_at: string;
  booked_by_kind: 'student' | 'staff';
  cancelled_at: string | null;
  cancelled_by_kind: 'student' | 'staff' | null;
  cancel_reason: string | null;
};

export type Feedback = {
  id: string;
  booking_id: string;
  company_id: string;
  application_id: string;
  ratings: Record<string, number>;
  strengths: string | null;
  improvements: string | null;
  overall: string | null;
  submitted_at: string;
  updated_at: string;
  released_at: string | null;
  email_sent_at: string | null;
};

export type EmailKind =
  | 'accepted'
  | 'booking_confirmed'
  | 'booking_moved'
  | 'booking_cancelled'
  | 'reminder'
  | 'feedback';

export type OutboxRow = {
  id: string;
  edition_id: string;
  application_id: string | null;
  to_email: string;
  to_name: string | null;
  locale: 'ar' | 'en';
  kind: EmailKind;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  created_at: string;
  claimed_at: string | null;
  sent_at: string | null;
  attempts: number;
  last_error: string | null;
  provider_id: string | null;
};

export type AuditRow = {
  id: number;
  edition_id: string | null;
  at: string;
  actor_kind: 'member' | 'student' | 'company' | 'system';
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  table_name: string;
  row_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/** The fixed lists the apply form offers (with "other" allowed). */
export const UNIVERSITIES = [
  'ksu',
  'imamu',
  'pnu',
  'psu',
  'psau',
  'alfaisal',
  'iau',
  'other',
] as const;

export const LEVELS = ['year1', 'year2', 'year3', 'year4', 'year5', 'graduate'] as const;

export const ENGLISH_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

/** One row of a day board (floor, interviewer page, TV): JSON-safe, names resolved. */
export type FloorRow = {
  slot_id: string;
  booking_id: string | null;
  application_id: string | null;
  company_id: string;
  company_name_en: string;
  company_name_ar: string;
  room_name: string;
  starts_at: string;
  ends_at: string;
  is_closed: boolean;
  student_name: string | null;
  student_phone: string | null;
  stage: Stage | null;
  arrived_at: string | null;
  stage_changed_at: string | null;
};
