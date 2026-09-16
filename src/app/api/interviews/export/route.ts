import { NextResponse, type NextRequest } from 'next/server';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { snapshotEdition } from '@/lib/interviews/export';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';

/** A manager downloading the whole edition as one JSON file. */
export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project') ?? '';
  if (!project) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const access = await getInterviewAccess(project);
  if (!access?.edition) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!can.manage(access.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const snapshot = await snapshotEdition(createInterviewsClient(), access.edition.id);
  const filename = `interviews-${access.edition.public_slug}-${toDateInput(new Date())}.json`;

  return new NextResponse(JSON.stringify(snapshot, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
