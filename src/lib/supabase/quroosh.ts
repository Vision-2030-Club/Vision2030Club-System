import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Quroosh (قروش) database — a SEPARATE Supabase project, set up the way
 * the Mock Interviews one is (lib/supabase/interviews.ts).
 *
 * Applications (founders' names, phones, emails, ages) live there, apart
 * from the club's data. Nobody but this server talks to it: its Row Level
 * Security is deny-all with no policies, its functions are executable by the
 * secret key only, and the browser is never given a key for it. The club
 * database decides who may open the Quroosh component and as what
 * (`my_component_access`, club 0074); this client is only reached after
 * that answer, or from the public application form, whose one write is
 * `apply()`.
 *
 * Only the URL and the SECRET key are used. The project's publishable key
 * and JWKS URL are not needed: nothing signs in to this database.
 */

const WHERE =
  'Set it in Vercel → Project → Settings → Environment Variables (or in .env.local locally), then redeploy.';

export function qurooshEnv(): { url: string; secretKey: string } {
  const url = process.env.QUROOSH_SUPABASE_URL;
  const secretKey = process.env.QUROOSH_SUPABASE_SECRET_KEY;

  const missing = [!url && 'QUROOSH_SUPABASE_URL', !secretKey && 'QUROOSH_SUPABASE_SECRET_KEY'].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(' and ')} is not set on this deployment — the Quroosh database is unreachable. ${WHERE}`,
    );
  }
  return { url: url as string, secretKey: secretKey as string };
}

/** True when the Quroosh project is configured on this deployment. */
export function isQurooshConfigured(): boolean {
  return Boolean(process.env.QUROOSH_SUPABASE_URL && process.env.QUROOSH_SUPABASE_SECRET_KEY);
}

export function createQurooshClient(): SupabaseClient {
  const { url, secretKey } = qurooshEnv();
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
