import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/** The six scopes from spec §2, mirrored from the `permission_scope` enum. */
export type Scope =
  | 'all'
  | 'own_team'
  | 'own_projects'
  | 'assigned'
  | 'own'
  | 'none';

export type MyMember = {
  id: string;
  email: string;
  name_en: string;
  name_ar: string;
  status: 'active' | 'inactive' | 'alumni';
  student_id: string;
  team_id: string;
  team_key: string;
  team_name_en: string;
  team_name_ar: string;
  role_id: string;
  role_key: string;
  role_name_en: string;
  role_name_ar: string;
};

/**
 * The signed-in person's profile. `cache()` keeps it to one query per request
 * even when several components ask for it.
 */
export const getMyMember = cache(async (): Promise<MyMember | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc('my_member');
  return (data as MyMember) ?? null;
});

/**
 * The caller's scope for every permission, straight from the (role,
 * permission) -> scope mapping.
 *
 * This is for the UI: greying out a button the user can't use, and giving a
 * readable error before the request leaves the server. It is NOT the security
 * boundary — that is the RLS policies in supabase/migrations. Anyone can call
 * the API directly and will still be refused there.
 */
export const getMyPermissions = cache(async (): Promise<Map<string, Scope>> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc('my_permissions');
  const map = new Map<string, Scope>();
  for (const row of (data ?? []) as { permission_key: string; scope: Scope }[]) {
    map.set(row.permission_key, row.scope);
  }
  return map;
});

export async function scopeFor(permission: string): Promise<Scope> {
  return (await getMyPermissions()).get(permission) ?? 'none';
}

/** True when the role has *some* access to a permission, whatever the scope. */
export async function hasPermission(permission: string): Promise<boolean> {
  return (await scopeFor(permission)) !== 'none';
}

export class PermissionError extends Error {
  constructor(permission: string) {
    super(`Permission denied: ${permission}`);
    this.name = 'PermissionError';
  }
}

/** Fail early with a clear message. The database checks again regardless. */
export async function requirePermission(permission: string): Promise<void> {
  if (!(await hasPermission(permission))) {
    throw new PermissionError(permission);
  }
}
