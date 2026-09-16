import { NextResponse, type NextRequest } from 'next/server';
import { buildBoard } from '@/lib/interviews/board';
import { loadDayRows, toBoardBookings } from '@/lib/interviews/queries';
import { isToken } from '@/lib/interviews/tokens';
import type { EditionSettings } from '@/lib/interviews/types';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';

/**
 * What the waiting-area TV polls every ten seconds. The token in the URL is
 * the edition's `tv_token`; there is no session. Today's held slots go
 * through `buildBoard`, so the screen and this route can never disagree
 * about who is being called.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (!isToken(token) || !isInterviewsConfigured()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const db = createInterviewsClient();
  const { data: edition } = await db
    .from('editions')
    .select('id, time_zone')
    .eq('tv_token', token)
    .maybeSingle();
  if (!edition) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [{ data: settings }, rows] = await Promise.all([
    db.rpc('edition_settings', { p_edition: edition.id }),
    loadDayRows(db, edition.id as string, toDateInput(new Date()), edition.time_zone as string),
  ]);
  const minutes = (settings as EditionSettings | null)?.tv_call_minutes ?? 5;

  return NextResponse.json(buildBoard(toBoardBookings(rows), Date.now(), minutes), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
