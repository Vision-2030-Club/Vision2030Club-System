/** Rows of the Quroosh database's tables (supabase/quroosh/migrations). */

export type QurooshSettings = {
  project_id: string;
  applications_open: boolean;
  privacy_url: string | null;
  /** The applications Google Sheet (0003; absent before it is applied). */
  sheet_id?: string | null;
  sheet_url?: string | null;
  updated_at: string;
  updated_by: string | null;
};

export type QurooshApplicationMember = {
  name: string;
  phone: string;
  email: string;
  sort_order: number;
};

/**
 * One application. The answers to the form's own questions are the columns
 * named in QUESTIONS (src/lib/quroosh/questions.ts), read by name, so they
 * are left open here; since 0004 the answers to questions a manager added are
 * under `answers`, by question key (absent before 0004 is applied). Read an
 * answer with `answerOf` (src/lib/quroosh/form.ts).
 */
export type QurooshApplication = Record<string, unknown> & {
  id: string;
  project_id: string;
  created_at: string;
  founder_name: string;
  email: string;
  phone: string;
  /** Empty since 0004 when a manager hid the question. */
  venture_name: string | null;
  has_team: boolean | null;
  funding: string[] | null;
  wants: string[] | null;
  answers?: Record<string, unknown>;
  application_members: QurooshApplicationMember[];
};

/** A row of the Quroosh database's `questions` (0004): see QuestionRow in src/lib/quroosh/form.ts. */
export type { QuestionRow as QurooshQuestion } from './form';

/** A time a guest can book (Quroosh 0005, `guest_slots`). Sessions are 45 minutes. */
export type QurooshGuestSlot = {
  id: string;
  project_id: string;
  starts_at: string;
  /** Off: not offered to guests. Slots are never deleted. */
  active: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

/** Speakers only for now; a new role needs a migration (the CHECK in 0005) and its wording. */
export type QurooshGuestRole = 'speaker';

/**
 * An invited guest and their booking (Quroosh 0005, `guest_invitations`).
 * The status is not stored: see `invitationStatus` in src/lib/quroosh/guests.ts.
 */
export type QurooshGuestInvitation = {
  id: string;
  project_id: string;
  /** The guest's link, /quroosh/invite/<token>: the only key to it. */
  token: string;
  role: QurooshGuestRole;
  name: string;
  /** The managers' own note; never shown to the guest. */
  note: string | null;
  slot_id: string | null;
  /** E.164, `+` and the country code. */
  phone: string | null;
  needs_transport: boolean | null;
  transport_phone: string | null;
  booked_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
};
