import { NextResponse } from 'next/server';
import { hasApiKey, listCheckIns, readSince, UUID } from '@/lib/eventAttendance/api';

/**
 * GET /api/event-attendance/<project id>/check-ins[?since=<ISO time>]
 *
 * The check-ins made or undone after `since` (all without it), oldest change
 * first, 5000 at most: page with the last row's `changed_at`. One row is one
 * attendee on one day of the club's calendar. A check-in the gate undid
 * comes back with `undone_at` set, so a component that gave something for it
 * (points, say) can take it back.
 *
 * `Authorization: Bearer $EVENT_ATTENDANCE_API_KEY`, as on the attendees
 * route beside this one.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!hasApiKey(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { projectId } = await params;
  if (!UUID.test(projectId)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const since = readSince(new URL(request.url).searchParams.get('since'));
  if (since === false) return NextResponse.json({ error: 'invalid', message: 'since is not a time.' }, { status: 400 });

  try {
    return NextResponse.json({ check_ins: await listCheckIns(projectId, since) });
  } catch (caught) {
    return NextResponse.json({ error: 'failed', message: caught instanceof Error ? caught.message : 'failed' }, { status: 500 });
  }
}
