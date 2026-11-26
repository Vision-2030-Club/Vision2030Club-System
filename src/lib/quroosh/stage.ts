import 'server-only';
import { getFinalProjectsAdmin, getFinalStatus } from '@/lib/quroosh/final';
import { rankStage, type StageSnapshot } from '@/lib/quroosh/stageBoard';

/**
 * The stage screen's read (docs/quroosh.md, "The stage screen"): the Final
 * Wave's projects, ranked, for the public page on the stage's screen and the
 * route it polls. Both go through here, so they cannot disagree.
 *
 * The page is open to anyone who has its address, so this file decides what
 * leaves the server:
 *   - while the Final Wave is hidden, the status and nothing else. The
 *     projects are not even read.
 *   - otherwise the projects guests can see, with what each collected and
 *     from how many guests. Never a hidden project, and never anything about
 *     a guest.
 *
 * Null means "could not read" (the database is not configured, 0014 is not
 * applied, it was slow or it failed), never "nothing to show": the screen
 * keeps its last board on a null instead of going blank in front of the hall.
 */

/** Longer than this and the screen is better served by its last board. */
const READ_TIMEOUT_MS = 4000;

async function read(projectId: string): Promise<StageSnapshot | null> {
  // Null too when the Quroosh database is not configured, so the read below
  // (which has no such check of its own) is only reached when it is.
  const status = await getFinalStatus(projectId);
  if (status === null) return null;
  if (status === 'hidden') return { at: Date.now(), status, projects: [], total: 0, gifts: 0 };

  const rows = await getFinalProjectsAdmin(projectId);
  if (rows === null) return null;
  const shown = rows.filter((row) => !row.hidden);
  return {
    at: Date.now(),
    status,
    // Field by field: the managers' row also carries `hidden`, `position` and
    // `gifts`, and a spread would publish whatever is added to it later.
    projects: rankStage(
      shown.map((row) => ({
        id: row.id,
        name: row.name,
        brief: row.brief,
        received: row.received,
        givers: row.givers,
      })),
    ),
    // Over the projects shown, so the screen's numbers add up. (The managers'
    // tiles count hidden projects as well.)
    total: shown.reduce((sum, row) => sum + row.received, 0),
    gifts: shown.reduce((sum, row) => sum + row.gifts, 0),
  };
}

export async function getStageSnapshot(projectId: string): Promise<StageSnapshot | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(projectId),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
