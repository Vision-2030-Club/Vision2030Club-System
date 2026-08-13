import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Server-side client acting AS THE SIGNED-IN USER.
 *
 * Use this for every ordinary read and write. Because it sends the user's own
 * token, Postgres applies the same RLS policies it would for a direct API
 * call — the database stays the security boundary, not this code.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The proxy refreshes the session cookie instead, so this is safe
            // to ignore.
          }
        },
      },
    },
  );
}
