import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Which companies are FULL: still on the form, blurred and unclickable, and
 * refused by both forms' server actions. Kept as `full_companies` (a list of
 * company ids) in the edition's settings, which `update_edition` already
 * merges, so it works without migration 0010. (0010's `companies.is_full` and
 * `set_company_full` are unused; this list is the one source of truth.)
 *
 * The refusal lives here rather than in SQL for the same reason; it runs in
 * applyAction and registerAction before anything is uploaded or written.
 */
export function fullCompanyIds(settings: { full_companies?: unknown } | null | undefined): Set<string> {
  const list = settings?.full_companies;
  return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []);
}

/**
 * True when the submission newly chooses a full company. One this student
 * (same email, same edition) already held keeps its place, so fixing a typo
 * never costs them a company they had.
 */
export async function choosesFullCompany(
  db: SupabaseClient,
  editionId: string,
  email: string | null | undefined,
  chosen: string[],
  full: Set<string>,
): Promise<boolean> {
  const wanted = chosen.filter((id) => full.has(id));
  if (wanted.length === 0) return false;
  if (!email) return true;

  const { data: existing } = await db
    .from('applications')
    .select('id')
    .eq('edition_id', editionId)
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();
  if (!existing) return true;

  const { data: held } = await db
    .from('application_preferences')
    .select('company_id')
    .eq('application_id', existing.id as string);
  const heldIds = new Set(((held ?? []) as { company_id: string }[]).map((p) => p.company_id));
  return wanted.some((id) => !heldIds.has(id));
}
