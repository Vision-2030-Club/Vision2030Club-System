/**
 * The semester as a unit.
 *
 * `semester_settings` (migration 0067) holds one row naming the semester and
 * bounding it; `club_semester_kpi` counts this semester's tasks by state. The
 * arithmetic here turns those two dates and today into "week 7 of 15", the
 * one figure that is not a database column.
 */

export type SemesterSettings = {
  name_en: string;
  name_ar: string;
  /** `YYYY-MM-DD` */
  starts_on: string;
  /** `YYYY-MM-DD` */
  ends_on: string;
};

export type ClubSemesterKpi = SemesterSettings & {
  planned_tasks: number;
  completed_tasks: number;
  not_done_tasks: number;
  pending_tasks: number;
  overdue_tasks: number;
};

export type SemesterPosition = {
  /** Where today falls relative to the semester. */
  phase: 'before' | 'during' | 'after';
  /** 1-based, clamped to the semester. */
  week: number;
  /** Total weeks, counting a partial last week as one. */
  weeks: number;
  /** 0–1, how far through the semester today is. */
  progress: number;
};

/** Whole days from one `YYYY-MM-DD` to another, built at UTC noon so a clock change can never shift the date. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd, 12);
  const b = Date.UTC(ty, tm - 1, td, 12);
  return Math.round((b - a) / 86_400_000);
}

/**
 * "Week 7 of 15" for a semester, given today on the club's clock
 * (`toDateInput(new Date())`). Both bounds are inclusive.
 */
export function semesterPosition(
  startsOn: string,
  endsOn: string,
  today: string,
): SemesterPosition {
  const length = daysBetween(startsOn, endsOn) + 1;
  const weeks = Math.max(1, Math.ceil(length / 7));
  const elapsed = daysBetween(startsOn, today);

  if (elapsed < 0) return { phase: 'before', week: 1, weeks, progress: 0 };
  if (elapsed >= length) return { phase: 'after', week: weeks, weeks, progress: 1 };

  return {
    phase: 'during',
    week: Math.min(weeks, Math.floor(elapsed / 7) + 1),
    weeks,
    progress: (elapsed + 1) / length,
  };
}
