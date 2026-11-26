/**
 * The stage screen's board (docs/quroosh.md, "The stage screen"): what the
 * server sends the screen at the closing ceremony, and the one rule that
 * ranks it.
 *
 * No imports, on purpose. The screen is a client component and takes its
 * types from here; the server ranks with `rankStage`, so the page's first
 * paint and every later read cannot disagree; and the rule can be run on its
 * own.
 */

/** hidden: nothing but the status is sent. open: guests are giving. closed: the final results. */
export type StageStatus = 'hidden' | 'open' | 'closed';

/** A project as the managers list it, before it is ranked. */
export type StageRow = {
  id: string;
  name: string;
  brief: string | null;
  /** Quroosh it collected. */
  received: number;
  /** How many guests gave to it. */
  givers: number;
};

export type StageProject = StageRow & {
  /** Its place, shared by equal totals. Null until it has collected something. */
  place: number | null;
  /** Its bar: the total as a share of the leader's, 0 to 100. */
  share: number;
};

export type StageSnapshot = {
  /** When the server read it, in milliseconds. The screen drops an answer older than the one it shows. */
  at: number;
  status: StageStatus;
  /** Ranked, most first. Empty while hidden. */
  projects: StageProject[];
  /** Quroosh given to the projects shown. */
  total: number;
  /** How many gifts that was. */
  gifts: number;
};

/**
 * Ranks the projects shown to guests, given in the managers' order.
 *
 * The same rule as the boards that exist (`final_board`, the managers' top
 * ten): most quroosh first, and equal totals share a place, so two leaders
 * are both first and the next project is third. A project that has collected
 * nothing has no place yet and no medal, and stays below in the managers'
 * order: otherwise, with two projects backed, the other eight would all be
 * "third". The bar is the total's share of the leader's, never thinner than
 * 4% once there is something to show, as on the guests' page.
 */
export function rankStage(shown: StageRow[]): StageProject[] {
  // Array.prototype.sort is stable: equal totals keep the managers' order.
  const ranked = [...shown].sort((a, b) => b.received - a.received);
  const lead = ranked[0]?.received ?? 0;
  return ranked.map((row) => ({
    id: row.id,
    name: row.name,
    brief: row.brief,
    received: row.received,
    givers: row.givers,
    place: row.received > 0 ? ranked.filter((other) => other.received > row.received).length + 1 : null,
    share: lead > 0 && row.received > 0 ? Math.max(4, Math.round((row.received / lead) * 100)) : 0,
  }));
}

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A club project's id is a UUID; anything else never reaches the database. */
export function isProjectId(value: string | null | undefined): value is string {
  return typeof value === 'string' && PROJECT_ID.test(value);
}

/**
 * Whether an answer from the poll route has the board's shape. The screen
 * stays up for hours across deployments: an answer it cannot read is
 * ignored and the last board stays, rather than a crash on the stage.
 */
export function isStageSnapshot(value: unknown): value is StageSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.status !== 'hidden' && snapshot.status !== 'open' && snapshot.status !== 'closed') return false;
  if (typeof snapshot.at !== 'number' || typeof snapshot.total !== 'number' || typeof snapshot.gifts !== 'number') {
    return false;
  }
  if (!Array.isArray(snapshot.projects)) return false;
  return snapshot.projects.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const project = entry as Record<string, unknown>;
    return (
      typeof project.id === 'string' &&
      typeof project.name === 'string' &&
      (project.brief === null || typeof project.brief === 'string') &&
      typeof project.received === 'number' &&
      typeof project.givers === 'number' &&
      (project.place === null || typeof project.place === 'number') &&
      typeof project.share === 'number'
    );
  });
}
