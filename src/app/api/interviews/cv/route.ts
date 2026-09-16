import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { signCv } from '@/lib/interviews/cv';
import { pinCookieName, pinCookieValue } from '@/lib/interviews/pin';
import { isToken } from '@/lib/interviews/tokens';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';

/**
 * Opens a CV. Two callers, two proofs:
 *
 *   ?token=<company link>&booking=<id>     the interviewer, for a student on
 *                                          THEIR list (and past the PIN, if set)
 *   ?project=<id>&application=<id>         a signed-in HR person or manager
 *
 * Either way the answer is a redirect to a URL that works for ten minutes,
 * signed by the server for a bucket nobody else can read.
 */
export async function GET(request: NextRequest) {
  if (!isInterviewsConfigured()) return notFound();
  const params = request.nextUrl.searchParams;
  const db = createInterviewsClient();

  let path: string | null = null;

  const token = params.get('token');
  const booking = params.get('booking');
  if (token && booking) {
    if (!isToken(token)) return notFound();
    const { data: company } = await db
      .from('companies')
      .select('id, access_pin')
      .eq('access_token', token)
      .maybeSingle();
    if (!company) return notFound();

    if (company.access_pin) {
      const jar = await cookies();
      if (
        jar.get(pinCookieName(company.id as string))?.value !==
        pinCookieValue(token, company.access_pin as string)
      ) {
        return NextResponse.json({ error: 'PIN required' }, { status: 403 });
      }
    }

    const { data: row } = await db
      .from('bookings')
      .select('application_id')
      .eq('id', booking)
      .eq('company_id', company.id)
      .is('cancelled_at', null)
      .maybeSingle();
    if (!row) return notFound();

    const { data: application } = await db
      .from('applications')
      .select('cv_path')
      .eq('id', row.application_id)
      .maybeSingle();
    path = (application?.cv_path as string | null) ?? null;
  } else {
    const project = params.get('project') ?? '';
    const applicationId = params.get('application') ?? '';
    if (!project || !applicationId) return notFound();

    const access = await getInterviewAccess(project);
    if (!access?.edition || !can.decide(access.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: application } = await db
      .from('applications')
      .select('cv_path')
      .eq('id', applicationId)
      .eq('edition_id', access.edition.id)
      .maybeSingle();
    path = (application?.cv_path as string | null) ?? null;
  }

  const url = await signCv(db, path);
  if (!url) return notFound();

  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
