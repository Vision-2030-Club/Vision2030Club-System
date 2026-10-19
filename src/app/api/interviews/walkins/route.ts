import { NextResponse, type NextRequest } from 'next/server';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { editionToday, loadWalkinQueue } from '@/lib/interviews/walkins';
import { createInterviewsClient } from '@/lib/supabase/interviews';

/**
 * What the Reception tab's walk-in queue polls every ten seconds: the waiting
 * requests, today's decided ones, and the free times (walkins.ts). Signed in,
 * and only for those who may work the desk (can.reception).
 */
export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project') ?? '';
  if (!project) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const access = await getInterviewAccess(project);
  if (!access?.edition) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!can.reception(access.role, access.desk)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const queue = await loadWalkinQueue(createInterviewsClient(), access.edition.id, editionToday(access.edition));
  return NextResponse.json(queue, { headers: { 'Cache-Control': 'no-store' } });
}
