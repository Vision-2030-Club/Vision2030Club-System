import { NextResponse, type NextRequest } from 'next/server';
import { getMyMember, hasPermission } from '@/lib/auth/session';
import { exchangeCode, saveCredentials } from '@/lib/google/auth';

/**
 * Where Google sends the Super Admin back after they approve access.
 *
 * This lives outside `[locale]` because Google matches the redirect URI
 * character for character against the one registered in the Cloud console — a
 * URL that changes with the language would need two registrations and would
 * break the day somebody adds a third locale. The locale is carried in
 * `state` instead and used only to redirect afterwards.
 *
 * The permission is re-checked here even though the button that started this
 * was only shown to a Super Admin: a callback URL is a URL, and anybody can
 * visit one.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const locale = params.get('state') === 'en' ? 'en' : 'ar';
  const back = (result: string) =>
    NextResponse.redirect(new URL(`/${locale}/admin/google?result=${result}`, request.nextUrl));

  const member = await getMyMember();
  if (!member) return back('signed_out');

  if (!(await hasPermission('integrations.configure'))) {
    return back('not_permitted');
  }

  // The person declined on Google's screen, or Google refused.
  const error = params.get('error');
  if (error) return back(`google_${error}`);

  const code = params.get('code');
  if (!code) return back('no_code');

  try {
    const { refresh_token, scopes, email } = await exchangeCode(code);
    await saveCredentials({
      refresh_token,
      scopes,
      google_email: email,
      connected_by: member.id,
    });
    return back('connected');
  } catch (caught) {
    // The message can carry Google's own wording, which is more useful than
    // anything generic — but it must not end up in a URL, so it is logged and
    // the page shows a stable code.
    console.error('[google] authorisation failed:', caught);
    return back('exchange_failed');
  }
}
