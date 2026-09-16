import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';
import { supabaseEnv } from '@/lib/supabase/env';

const handleLocale = createIntlMiddleware(routing);

/**
 * Paths (after the locale prefix) reachable without being signed in.
 *
 * `/interviews/...` is the Mock Interviews component's public face: the apply
 * form, a student's personal link, a company's interviewer link and the
 * waiting-area TV. Each is guarded by an unguessable token checked on the
 * server, not by a session.
 */
const PUBLIC_PATHS = ['/login', '/interviews'];

/** Public paths that make no sense once signed in: a member is sent on. */
const SIGNED_OUT_ONLY_PATHS = ['/login'];

/**
 * Runs before every page render. Two jobs:
 *   1. resolve the locale prefix (`/` → `/ar`)
 *   2. refresh the Supabase session cookie and bounce signed-out visitors
 *      to the login page
 *
 * This redirect is a convenience, NOT the security boundary — the real
 * enforcement is the RLS policies in Postgres. See supabase/migrations.
 */
export async function proxy(request: NextRequest) {
  // next-intl decides the final URL/locale first; we then attach cookies to
  // whatever response it produced (a rewrite, a redirect, or a pass-through).
  const response = handleLocale(request);

  // Throws with a readable message naming the missing variable. This runs
  // before every page, so a misconfigured deployment fails here first — better
  // that the log says which setting is missing than that the whole site
  // answers 500 with nothing to go on.
  const { url: supabaseUrl, anonKey } = supabaseEnv();

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates the token with Supabase and refreshes it if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const segments = pathname.split('/').filter(Boolean);
  const locale = routing.locales.includes(segments[0] as never)
    ? segments[0]
    : routing.defaultLocale;
  const pathAfterLocale = '/' + segments.slice(1).join('/');
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathAfterLocale === p || pathAfterLocale.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    url.search = '';
    return NextResponse.redirect(url);
  }

  // An organizer opening the TV link while signed in must get the TV, not
  // the dashboard — only the login page bounces a signed-in visitor.
  const isSignedOutOnly = SIGNED_OUT_ONLY_PATHS.some(
    (p) => pathAfterLocale === p || pathAfterLocale.startsWith(`${p}/`),
  );

  if (user && isSignedOutOnly) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/dashboard`;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Skip Next internals, the API routes, and static files.
  matcher: ['/((?!api|_next|_vercel|favicon.ico|brand|.*\\..*).*)'],
};
