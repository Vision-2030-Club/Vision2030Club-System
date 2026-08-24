/**
 * The Supabase settings, read once and complained about clearly.
 *
 * These used to be read with `process.env.X!`, and a non-null assertion is a
 * promise to TypeScript, not a check. On a host where the variable is missing
 * the value is `undefined`, the Supabase client throws something unhelpful,
 * and — because the first thing to touch it is the proxy that runs before
 * every page — the whole site answers `500 Internal Server Error` with no
 * clue why.
 *
 * That happened on the first Vercel deploy. The fix is not clever: say which
 * variable is missing, in a sentence that names where to set it, so the answer
 * is in the log rather than in somebody's memory.
 */

export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

const WHERE =
  'Set it in Vercel → Project → Settings → Environment Variables (or in .env.local when running locally), then REDEPLOY — ' +
  'NEXT_PUBLIC_* values are baked in at build time, so restarting is not enough.';

export function supabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing = [
    !url && 'NEXT_PUBLIC_SUPABASE_URL',
    !anonKey && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`${missing.join(' and ')} is not set on this deployment. ${WHERE}`);
  }

  return { url: url as string, anonKey: anonKey as string };
}

/** The service-role key. Server-only, and never sent to the browser. */
export function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. ${WHERE}`);
  }
  return key;
}
