/** Rows of the Quroosh tables (club migration 0075). */

export type QurooshSettings = {
  project_id: string;
  applications_open: boolean;
  privacy_url: string | null;
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
 * One application. The answers are the columns named in QUESTIONS
 * (src/lib/quroosh/questions.ts), read by name, so they are left open here.
 */
export type QurooshApplication = Record<string, unknown> & {
  id: string;
  project_id: string;
  created_at: string;
  founder_name: string;
  email: string;
  phone: string;
  venture_name: string;
  has_team: boolean;
  funding: string[];
  wants: string[];
  quroosh_application_members: QurooshApplicationMember[];
};
