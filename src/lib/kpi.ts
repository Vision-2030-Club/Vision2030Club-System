/**
 * Shared vocabulary for the KPI module (addendum §1–§9).
 *
 * Everything here is presentation only. Not one number is computed in this
 * file — states, risk tiers and scores all arrive already derived from the
 * `task_kpi` / `member_kpi` / `project_kpi` views, because §1 and §6 require
 * them to be live reads of the database rather than something the UI decides.
 */

export type TaskState =
  | 'not_started'
  | 'in_progress'
  | 'pending_confirmation'
  | 'completed'
  | 'not_done';

export type TaskRisk =
  | 'low'
  | 'medium'
  | 'high'
  | 'overdue'
  | 'pending_review'
  | 'completed'
  | 'not_done'
  | 'none';

export type TaskQuality = 'excellent' | 'very_good' | 'good' | 'poor' | 'not_done';

export type ProjectHealth = 'on_track' | 'needs_attention' | 'at_risk';

/** One row of the `task_kpi` view. */
export type TaskKpi = {
  id: string;
  title: string;
  project_id: string | null;
  team_id: string | null;
  split_id: string | null;
  due_date: string | null;
  created_at: string;
  assigned_at: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  not_done_at: string | null;
  rejected_at: string | null;
  assignee_id: string | null;
  quality: TaskQuality | null;
  state: TaskState;
  days_remaining: number | null;
  risk: TaskRisk;
  /** Null whenever §8 bars the viewer from the grade — notably on their own work. */
  quality_score: number | null;
  completion_score: number | null;
  overall_score: number | null;
  counts_toward_kpi: boolean;
  is_delayed: boolean;
  /**
   * Capability flags computed by the same functions the RLS policies use, so a
   * button appears exactly when the action behind it would succeed. Hiding one
   * is a courtesy, never the boundary — the database checks again.
   */
  can_claim: boolean;
  can_confirm: boolean;
  can_administer: boolean;
  /** Set when this task was created by an accepted request (migration 0038). */
  source_request_id: string | null;
  /** Where the finished work is. Requests deliver a link, never an upload. */
  submission_url: string | null;
  /** True when submitting requires that link. */
  requires_link: boolean;
};

/**
 * A task once, with everyone on it.
 *
 * `task_kpi` is one row per (task, assignee) — that is how each person is
 * scored (0057 E). A LIST of tasks wants each once: this folds the rows,
 * keeping the first row's figures (they are identical across assignees,
 * apart from the viewer-specific score masking, which is the same for
 * every row too) and collecting the assignee ids. `isMine` is any of them.
 */
export type TaskWithAssignees = {
  task: TaskKpi;
  assigneeIds: string[];
};

export function groupTaskRows(rows: TaskKpi[]): TaskWithAssignees[] {
  const byId = new Map<string, TaskWithAssignees>();
  for (const row of rows) {
    const entry = byId.get(row.id);
    if (entry) {
      if (row.assignee_id && !entry.assigneeIds.includes(row.assignee_id)) {
        entry.assigneeIds.push(row.assignee_id);
      }
    } else {
      byId.set(row.id, { task: row, assigneeIds: row.assignee_id ? [row.assignee_id] : [] });
    }
  }
  return [...byId.values()];
}

export type MemberKpi = {
  member_id: string;
  total_tasks: number;
  scored_tasks: number;
  completed_tasks: number;
  not_done_tasks: number;
  in_progress_tasks: number;
  pending_tasks: number;
  delayed_tasks: number;
  high_risk_tasks: number;
  overdue_tasks: number;
  performance: number | null;
  team_performance: number | null;
  project_performance: number | null;
  health: ProjectHealth;
};

export type ProjectKpi = {
  project_id: string;
  total_tasks: number;
  scored_tasks: number;
  completed_tasks: number;
  not_done_tasks: number;
  delayed_tasks: number;
  high_risk_tasks: number;
  overdue_tasks: number;
  completion_pct: number | null;
  health: ProjectHealth;
};

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';

export const STATE_TONES: Record<TaskState, Tone> = {
  not_started: 'neutral',
  in_progress: 'brand',
  pending_confirmation: 'warn',
  completed: 'ok',
  not_done: 'danger',
};

/**
 * §4's colours. Overdue is dark red and deliberately distinct from High, which
 * is why it gets its own class rather than reusing the `danger` badge tone.
 */
export const RISK_CLASSES: Record<TaskRisk, string> = {
  low: 'bg-warn/10 text-warn',              // yellow — On Track
  medium: 'bg-orange-500/10 text-orange-600',
  high: 'bg-danger/10 text-danger',
  overdue: 'bg-danger text-white',          // dark red, unmistakably its own state
  pending_review: 'bg-brand-50 text-brand-700',
  completed: 'bg-ok/10 text-ok',
  not_done: 'bg-ink/10 text-ink',
  none: 'bg-surface-muted text-ink-muted',
};

/**
 * Chart fills for the same tiers.
 *
 * §4 prescribes the colours (yellow → orange → red → dark red, green for
 * Completed), and a same-hue severity ramp cannot clear the categorical
 * adjacent-pair separation bar — yellow/orange and red/dark-red sit under it by
 * construction. That is fine here only because the charts never ask hue to
 * carry identity: every bar sits on its own labelled row. All seven clear 3:1
 * against the white chart surface, bar the yellow at 2.94:1 — a WARN whose
 * required relief (visible row labels plus the table views below the charts)
 * is present. amber-700 passed contrast outright but read brown next to the
 * orange, which defeats the point of §4 naming two different colours.
 */
export const RISK_COLORS: Record<TaskRisk, string> = {
  low: '#ca8a04',
  medium: '#ea580c',
  high: '#d03b3b',
  overdue: '#7f1d1d',
  pending_review: '#0d94a4',
  completed: '#15803d',
  not_done: '#334155',
  none: '#94a3b8',
};

/**
 * Bar fill for single-series charts. brand-500 rather than the brand-600 used
 * for text: 600 falls just under the chroma floor and reads grey as a large
 * fill, while 500 clears both chroma and 3:1 contrast on white.
 */
export const CHART_BRAND = '#0d94a4';

/** The severity tiers in the order §4 lists them, for the distribution chart. */
export const RISK_TIERS = ['low', 'medium', 'high', 'overdue'] as const;

export const HEALTH_TONES: Record<ProjectHealth, Tone> = {
  on_track: 'ok',
  needs_attention: 'warn',
  at_risk: 'danger',
};

export const HEALTH_COLORS: Record<ProjectHealth, string> = {
  on_track: '#15803d',
  needs_attention: '#b45309',
  at_risk: '#b91c1c',
};

/** §4's Quality options, in the order a confirmer should read them. */
export const QUALITY_CHOICES = ['excellent', 'very_good', 'good', 'poor'] as const;

/** The 0–100 values, mirrored from app.quality_score() for display only. */
export const QUALITY_POINTS: Record<TaskQuality, number> = {
  excellent: 100,
  very_good: 75,
  good: 50,
  poor: 25,
  not_done: 0,
};

/** `in_progress` -> `stateInProgress`, matching the message catalog. */
export function stateKey(state: TaskState) {
  return `state${camel(state)}` as const;
}

export function riskKey(risk: TaskRisk) {
  return `risk${camel(risk)}` as const;
}

export function healthKey(health: ProjectHealth) {
  return `health${camel(health)}` as const;
}

export function qualityKey(quality: TaskQuality) {
  return `quality${camel(quality)}` as const;
}

function camel(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * A score for display. Null means "you may not see this" (§8) rather than
 * "zero", and the two must never look the same — a Not Done task really is 0.
 */
export function formatScore(value: number | string | null | undefined) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return Number.isNaN(n) ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}
