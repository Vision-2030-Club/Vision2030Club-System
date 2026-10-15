import { NextResponse, type NextRequest } from 'next/server';
import { getInterviewAccess } from '@/lib/interviews/access';
import { loadDayRows, toFloorRow } from '@/lib/interviews/queries';
import { createInterviewsClient } from '@/lib/supabase/interviews';

/**
 * What the floor board polls every twelve seconds, and the Reception tab
 * every ten. Signed in: the club session cookie identifies the person and
 * `getInterviewAccess` decides whether they may see this project's day at
 * all. One company's day when `company` is given (the floor board), every
 * company's when it is left out (reception).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const project = params.get('project') ?? '';
  const company = params.get('company') || undefined;
  const day = params.get('day') ?? '';

  if (!project || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const access = await getInterviewAccess(project);
  if (!access?.edition) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await loadDayRows(
    createInterviewsClient(),
    access.edition.id,
    day,
    access.edition.time_zone,
    company,
  );

  return NextResponse.json(
    { rows: rows.map(toFloorRow) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
