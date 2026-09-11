import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { serviceRoleKey, supabaseEnv } from './env';

/**
 * Service-role client. It BYPASSES Row Level Security, so it is deliberately
 * restricted to the two auth operations that need it and can't be expressed
 * as user-scoped queries:
 *
 *   1. creating the auth account on a member's first login (§5)
 *   2. a Super Admin resetting someone's password (§5 — no self-service reset)
 *   3. the two outbound integrations — Google Meet links (lib/google) and push
 *      delivery (lib/push) — whose tables have no user-facing policies at all
 *
 * Never use it for ordinary data access: doing so would silently skip every
 * permission rule the database enforces. Use `lib/supabase/server.ts` instead.
 */
export function createAdminClient() {
  return createClient(supabaseEnv().url, serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
