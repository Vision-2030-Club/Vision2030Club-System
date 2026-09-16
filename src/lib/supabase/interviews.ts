import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Mock Interviews database — a SEPARATE Supabase project.
 *
 * Everything about an interview week (applicants, companies, slots, bookings,
 * check-ins, feedback) lives there so the club database can never lose it and
 * it can never be lost with the club database. Nobody but this server ever
 * talks to it: its Row Level Security is deny-all, the browser is never given
 * a key for it, and every write goes through a Postgres function that records
 * WHO did it (see supabase/interviews/migrations).
 *
 * This is therefore the fourth — and last — place the service role is used in
 * this app (see lib/supabase/admin.ts for the other three). It is not a
 * loophole in the club's permission model: the club database decides who may
 * enter the interviews system at all (`my_component_access`), and this client
 * is only reached after that answer.
 *
 * Missing settings fail with a sentence naming the variable, for the same
 * reason lib/supabase/env.ts does: a blank page with a 500 is worse than a
 * log line saying what to set.
 */

const WHERE =
  'Set it in Vercel → Project → Settings → Environment Variables (or in .env.local locally), then redeploy.';

export function interviewsEnv(): { url: string; serviceKey: string } {
  const url = process.env.INTERVIEWS_SUPABASE_URL;
  const serviceKey = process.env.INTERVIEWS_SUPABASE_SERVICE_ROLE_KEY;

  const missing = [
    !url && 'INTERVIEWS_SUPABASE_URL',
    !serviceKey && 'INTERVIEWS_SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `${missing.join(' and ')} is not set on this deployment — the Mock Interviews database is unreachable. ${WHERE}`,
    );
  }
  return { url: url as string, serviceKey: serviceKey as string };
}

/** True when the interviews project is configured on this deployment. */
export function isInterviewsConfigured(): boolean {
  return Boolean(
    process.env.INTERVIEWS_SUPABASE_URL && process.env.INTERVIEWS_SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function createInterviewsClient(): SupabaseClient {
  const { url, serviceKey } = interviewsEnv();
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
