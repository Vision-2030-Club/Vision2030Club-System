import { NextResponse, type NextRequest } from 'next/server';
import { getStageSnapshot } from '@/lib/quroosh/stage';
import { isProjectId } from '@/lib/quroosh/stageBoard';

/**
 * What the stage screen asks every two seconds (docs/quroosh.md, "The stage
 * screen"). There is no session and no secret: the page is open to anyone
 * who has its address, and `getStageSnapshot` sends only what the hall sees
 * anyway (and nothing but the status while the Final Wave is hidden).
 *
 * A read that failed answers 503, and the screen keeps its last board.
 *
 * A good answer may be reused by the CDN for one second. One screen asking
 * every two seconds never meets it; it is there so that the address being
 * passed around a hall of phones still costs the database about one read a
 * second, while guests are giving from the same database.
 */
export const maxDuration = 10;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project');
  if (!isProjectId(project)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  }

  const snapshot = await getStageSnapshot(project.toLowerCase());
  if (!snapshot) {
    return NextResponse.json({ error: 'Unavailable' }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=1' },
  });
}
