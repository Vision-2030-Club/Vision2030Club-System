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
