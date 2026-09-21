'use server';

import { revalidatePath } from 'next/cache';
import { fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { PermissionError } from '@/lib/auth/session';
import { OUTREACH_STATUSES, typeKeyFrom, type OutreachStatus } from '@/lib/outreach/types';
import { can, requireOutreachAccess } from '@/lib/outreach/access';
import { createClient } from '@/lib/supabase/server';

/**
 * Outreach actions (0065). Every write goes through the caller's own session,
 * so the row policies decide: a member may change their own targets, a
 * manager any, a viewer none. The access check here only turns a refusal
 * into a sentence before the database is reached.
 */

function page(locale: string, projectId: string) {
  return `/${locale}/projects/${projectId}/outreach`;
}

type Guarded =
  | { locale: string; projectId: string; access: Awaited<ReturnType<typeof requireOutreachAccess>> }
  | { error: string };

async function guard(
  formData: FormData,
  allowed: Parameters<typeof requireOutreachAccess>[1],
): Promise<Guarded> {
  const locale = requiredText(formData, 'locale');
  const projectId = requiredText(formData, 'project_id');
  try {
    const access = await requireOutreachAccess(projectId, allowed);
    return { locale, projectId, access };
  } catch (error) {
    if (error instanceof PermissionError) return { error: error.message };
    throw error;
  }
}

function statusOf(formData: FormData): OutreachStatus | null {
  const value = text(formData, 'status');
  return value && (OUTREACH_STATUSES as readonly string[]).includes(value)
    ? (value as OutreachStatus)
    : null;
}

export async function addTargetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.add);
  if ('error' in g) return fail(g.error);

  const supabase = await createClient();
  const { error } = await supabase.from('outreach_targets').insert({
    project_id: g.projectId,
    type_key: requiredText(formData, 'type_key'),
    name: requiredText(formData, 'name'),
    // A member adds for themselves unless a manager picks someone else.
    owner_id: text(formData, 'owner_id') ?? g.access.me.id,
    status: statusOf(formData) ?? 'new',
    notes: text(formData, 'notes'),
    created_by: g.access.me.id,
  });
  if (error) return fromPostgrest(error);

  revalidatePath(page(g.locale, g.projectId));
  return ok('created');
}

export async function updateTargetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.add);
  if ('error' in g) return fail(g.error);

  const patch: Record<string, unknown> = {
    name: requiredText(formData, 'name'),
    type_key: requiredText(formData, 'type_key'),
    notes: text(formData, 'notes'),
  };
  // Only a manager reassigns; a member's form does not carry the field.
  if (formData.has('owner_id')) patch.owner_id = text(formData, 'owner_id');
  const status = statusOf(formData);
  if (status) patch.status = status;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('outreach_targets')
    .update(patch)
    .eq('id', requiredText(formData, 'target_id'))
    .eq('project_id', g.projectId)
    .select('id');
  if (error) return fromPostgrest(error);
  if (!data?.length) return fail('This target is not yours to change.');

  revalidatePath(page(g.locale, g.projectId));
  return ok();
}

/** The one-click change from the list: a select that submits itself. */
export async function setTargetStatusAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.add);
  if ('error' in g) return fail(g.error);

  const status = statusOf(formData);
  if (!status) return fail('Unknown status.');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('outreach_targets')
    .update({ status })
    .eq('id', requiredText(formData, 'target_id'))
    .eq('project_id', g.projectId)
    .select('id');
  if (error) return fromPostgrest(error);
  if (!data?.length) return fail('This target is not yours to change.');

  revalidatePath(page(g.locale, g.projectId));
  return ok();
}

export async function deleteTargetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from('outreach_targets')
    .delete()
    .eq('id', requiredText(formData, 'target_id'))
    .eq('project_id', g.projectId);
  if (error) return fromPostgrest(error);

  revalidatePath(page(g.locale, g.projectId));
  return ok();
}

export async function addTypeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const nameEn = requiredText(formData, 'name_en');
  const nameAr = text(formData, 'name_ar') ?? nameEn;
  const supabase = await createClient();
  const { error } = await supabase.from('outreach_types').insert({
    project_id: g.projectId,
    key: typeKeyFrom(nameEn),
    name_en: nameEn,
    name_ar: nameAr,
    sort_order: Number(text(formData, 'sort_order') ?? 100) || 100,
  });
  if (error) return fromPostgrest(error);

  revalidatePath(page(g.locale, g.projectId));
  return ok('created');
}

/** A type goes only while nothing uses it; the foreign key refuses otherwise. */
export async function removeTypeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from('outreach_types')
    .delete()
    .eq('project_id', g.projectId)
    .eq('key', requiredText(formData, 'key'));
  if (error) {
    return error.code === '23503'
      ? fail('This type is in use. Move its targets to another type first.')
      : fromPostgrest(error);
  }

  revalidatePath(page(g.locale, g.projectId));
  return ok();
}
