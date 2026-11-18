/**
 * Shapes of what the club database's `event_*` functions return (0075).
 * Days are `YYYY-MM-DD` on the club's calendar; instants are ISO strings.
 */

export type EventTheme = 'quroosh' | 'interviews' | null;

/** `event_attendance_summary`: the numbers on the component's first page. */
export type EventSummary = {
  role: 'manager' | 'scanner';
  signup_open: boolean;
  first_day: string | null;
  last_day: string | null;
  today: string;
  attendees: number;
  cancelled: number;
  checked_in_today: number;
  days: { day: string; count: number }[];
  passes_waiting: number;
};

/** `event_public`: what the sign-up page needs. */
export type EventPublic = {
  name_en: string;
  name_ar: string;
  signup_open: boolean;
  first_day: string | null;
  last_day: string | null;
  theme: EventTheme;
};

/** `event_pass`: what a pass page shows. */
export type EventPass = {
  attendee_id: string;
  project_id: string;
  name: string;
  name_en: string;
  name_ar: string;
  cancelled: boolean;
  first_day: string | null;
  last_day: string | null;
  days: string[];
  theme: EventTheme;
};

/** `event_attendee_list`: one row of the managers' list. */
export type EventAttendeeRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  source: string;
  source_ref: string | null;
  created_at: string;
  cancelled_at: string | null;
  days: string[];
  pass_sent_at: string | null;
  pass_error: string | null;
};

/** `event_find_attendees`: one match at the gate. */
export type EventAttendeeMatch = {
  id: string;
  name: string;
  phone_tail: string;
  cancelled: boolean;
  checked_in_today: boolean;
};

/** `event_check_in`: what the scanner shows. */
export type EventCheckInResult = {
  result: 'checked_in' | 'already';
  attendee_id: string;
  name: string;
  day: string;
  at: string;
};

/** `event_api_attendees`: an attendee as another component reads it. */
export type EventApiAttendee = {
  id: string;
  token: string;
  name: string;
  phone: string;
  email: string | null;
  locale: 'ar' | 'en';
  source: string;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  days: string[];
};

/** `event_api_check_ins`: a check-in as another component reads it. */
export type EventApiCheckIn = {
  id: string;
  attendee_id: string;
  day: string;
  checked_in_at: string;
  via: 'scan' | 'manual';
  undone_at: string | null;
  changed_at: string;
};
