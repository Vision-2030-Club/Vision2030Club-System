import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side client. It carries the signed-in user's token, so every query
 * it makes is filtered by the database's Row Level Security policies.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
