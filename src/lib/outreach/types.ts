import type { ComponentProps } from 'react';
import type { Badge } from '@/components/ui';

type Tone = NonNullable<ComponentProps<typeof Badge>['tone']>;

/**
 * Where a conversation with a target stands: the seven steps the teams'
 * own trackers use, in the order the work flows through them (0066).
 */
export type OutreachStatus =
  | 'new'
  | 'waiting'
  | 'in_progress'
  | 'meeting'
  | 'on_hold'
  | 'confirmed'
  | 'rejected';

export const OUTREACH_STATUSES = [
  'new',
  'waiting',
  'in_progress',
  'meeting',
  'on_hold',
  'confirmed',
  'rejected',
] as const;

/** Nothing decided either way: still worth chasing. */
export const OUTREACH_OPEN: readonly OutreachStatus[] = [
  'new',
  'waiting',
  'in_progress',
  'meeting',
  'on_hold',
];

export const OUTREACH_STATUS_TONES: Record<OutreachStatus, Tone> = {
  new: 'neutral',
  waiting: 'warn',
  in_progress: 'brand',
  meeting: 'brand',
  on_hold: 'neutral',
  confirmed: 'ok',
  rejected: 'danger',
};

/** A kind of target one project chases: shark, sponsor, speaker, venue… */
export type OutreachType = {
  project_id: string;
  key: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
};

export type OutreachTarget = {
  id: string;
  project_id: string;
  type_key: string;
  name: string;
  owner_id: string | null;
  status: OutreachStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OutreachMemberSummary = {
  project_id: string;
  member_id: string | null;
  total: number;
  new_count: number;
  waiting: number;
  in_progress: number;
  meeting: number;
  on_hold: number;
  confirmed: number;
  rejected: number;
  conversion_pct: number | string | null;
};

export type OutreachTypeSummary = {
  project_id: string;
  type_key: string;
  total: number;
  open_count: number;
  confirmed: number;
  rejected: number;
  conversion_pct: number | string | null;
};

/** A type's key from its English name: "Event planner" → "event_planner". */
export function typeKeyFrom(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 31);
  return /^[a-z]/.test(key) ? key : `t_${key}`.slice(0, 31);
}
