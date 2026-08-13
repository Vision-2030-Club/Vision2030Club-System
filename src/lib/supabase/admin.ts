import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. It BYPASSES Row Level Security, so it is deliberately
 * restricted to the two auth operations that need it and can't be expressed
 * as user-scoped queries:
 *
 *   1. creating the auth account on a member's first login (§5)
 *   2. a Super Admin resetting someone's password (§5 — no self-service reset)
 *
 * Never use it for ordinary data access: doing so would silently skip every
 * permission rule the database enforces. Use `lib/supabase/server.ts` instead.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
