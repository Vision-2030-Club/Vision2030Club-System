import { NextResponse } from 'next/server';
import { hasApiKey, listAttendees, readSince, registerAttendee, UUID } from '@/lib/eventAttendance/api';
import { passUrl } from '@/lib/eventAttendance/links';

/**
 * Event attendance's HTTP API (0075), for a component outside this codebase.
 * A component inside it imports `@/lib/eventAttendance/api` instead.
 *
 *   GET  /api/event-attendance/<project id>/attendees[?since=<ISO time>]
 *        The attendees changed after `since` (all without it), oldest change
 *        first, 5000 at most. Page with the last row's `updated_at`.
 *
 *   POST /api/event-attendance/<project id>/attendees
 *        { "name", "phone", "email"?, "locale"?: "ar"|"en", "country"?: "SA",
 *          "source": "your_component", "source_ref"?: "your id",
 *          "send_pass"?: true }
 *        Registers a person and (unless send_pass is false) emails their
 *        pass. A mobile already registered answers 200 with that attendee and
 *        created: false, so sending the same person twice is safe.
 *
 * Every call sends `Authorization: Bearer $EVENT_ATTENDANCE_API_KEY`; anyone
 * else gets 401, and with no key set on the deployment everyone does. The
 * answers hold personal data: the key is a secret of the caller's server,
 * never of a page. The proxy excludes /api, so no session is involved.
 */

const REFUSAL_STATUS: Record<string, number> = { not_found: 404, attendee_cancelled: 409, signup_closed: 409 };

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Context) {
  if (!hasApiKey(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { projectId } = await params;
  if (!UUID.test(projectId)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const since = readSince(new URL(request.url).searchParams.get('since'));
  if (since === false) return NextResponse.json({ error: 'invalid', message: 'since is not a time.' }, { status: 400 });

  try {
    return NextResponse.json({ attendees: await listAttendees(projectId, since) });
  } catch (caught) {
    return NextResponse.json({ error: 'failed', message: caught instanceof Error ? caught.message : 'failed' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  if (!hasApiKey(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { projectId } = await params;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid', message: 'Send a JSON object.' }, { status: 400 });
  }
  const field = (key: string) => (typeof body[key] === 'string' ? (body[key] as string) : '');
  // A caller must say who it is: 'form' is the component's own sign-up page.
  const source = field('source');
  if (source === '' || source === 'form') {
    return NextResponse.json({ error: 'invalid', message: 'source must name your component.' }, { status: 400 });
  }

  const result = await registerAttendee({
    projectId,
    name: field('name'),
    phone: field('phone'),
    country: field('country') || undefined,
    email: field('email') || null,
    locale: field('locale'),
    source,
    sourceRef: field('source_ref') || null,
    requireOpen: false,
    sendPass: body.send_pass !== false,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.hint, message: result.message }, { status: REFUSAL_STATUS[result.hint] ?? 400 });
  }
  const locale = field('locale') === 'en' ? 'en' : 'ar';
  return NextResponse.json(
    {
      attendee_id: result.attendeeId,
      token: result.token,
      pass_url: passUrl(locale, result.token),
      created: result.created,
    },
    { status: result.created ? 201 : 200 },
  );
}
