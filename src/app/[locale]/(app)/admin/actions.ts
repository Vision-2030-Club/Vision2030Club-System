'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { fail, ok, requiredText, type ActionResult } from '@/lib/actions';

const SCOPES = ['all', 'own_team', 'own_projects', 'assigned', 'own', 'none'] as const;
type Scope = (typeof SCOPES)[number];

function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/**
 * Changes what a role may do (spec §2).
 *
 * This is the whole mechanism: one UPDATE to role_permissions and every policy
 * in the database behaves differently on the next query, because they all read
 * this table through app.can rather than naming roles themselves.
 *
 * Called directly from the matrix rather than through a form, so it takes
 * plain arguments instead of FormData.
 */
export async function setRolePermissionScopeAction(
  locale: string,
  roleId: string,
  permissionKey: string,
  scope: string,
): Promise<ActionResult> {
  if (!isScope(scope)) return fail(`Unknown scope: ${scope}`);

  const supabase = await createClient();

  // Every (role, permission) pair is seeded, but upsert keeps this correct if
  // a new permission is added without backfilling.
  const { error } = await supabase
    .from('role_permissions')
    .upsert(
      { role_id: roleId, permission_key: permissionKey, scope },
      { onConflict: 'role_id,permission_key' },
    );

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/admin/permissions`);
  return ok();
}

/**
 * A team-specific exception to the baseline — the mechanism behind "member
 * management belongs to HR's Directors and nobody else's".
 */
export async function addTeamOverrideAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const scope = requiredText(formData, 'scope');
  if (!isScope(scope)) return fail(`Unknown scope: ${scope}`);

  const supabase = await createClient();
  const { error } = await supabase.from('role_permission_team_overrides').upsert(
    {
      role_id: requiredText(formData, 'role_id'),
      permission_key: requiredText(formData, 'permission_key'),
      team_id: requiredText(formData, 'team_id'),
      scope,
    },
    { onConflict: 'role_id,permission_key,team_id' },
  );

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/admin/permissions`);
  return ok();
}

export async function removeTeamOverrideAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase
    .from('role_permission_team_overrides')
    .delete()
    .eq('role_id', requiredText(formData, 'role_id'))
    .eq('permission_key', requiredText(formData, 'permission_key'))
    .eq('team_id', requiredText(formData, 'team_id'));

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/admin/permissions`);
  return ok();
}

export type ImportReport = {
  ok: boolean;
  created: number;
  updated: number;
  project_links: number;
  errors: { row: number; field: string; reason: string; value: string | null }[];
};

/**
 * Runs the CSV import (spec §4).
 *
 * The rows arrive already parsed by the browser; all validation and the
 * all-or-nothing rule live in `import_members`, so this just hands the array
 * over and returns whatever report comes back.
 */
export async function importMembersAction(
  locale: string,
  rows: Record<string, string>[],
): Promise<{ result?: ImportReport; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('import_members', { p_rows: rows });

  if (error) return { error: error.message };

  const result = data as ImportReport;
  if (result.ok) revalidatePath(`/${locale}/members`);

  return { result };
}
