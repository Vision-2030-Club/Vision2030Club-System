'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { fail, fromPostgrest, ok, requiredText, type ActionResult } from '@/lib/actions';
import { SLUG_PATTERN } from '@/lib/links';

/**
 * The database decides who may touch short links: every policy on
 * `short_links` asks `app.can('links.manage')`. These actions turn the forms
 * into writes and hand back what Postgres said.
 */

/** A full http(s) address, or a sentence saying why not. */
function checkTarget(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function createShortLinkAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const slug = requiredText(formData, 'slug').toLowerCase();
  const target = checkTarget(requiredText(formData, 'target_url'));

  if (!SLUG_PATTERN.test(slug)) {
    return fail('The short name may use lower-case letters, digits and hyphens only, up to 40 characters.');
  }
  if (!target) return fail('The destination must be a full address starting with https://.');

  const supabase = await createClient();
  const { error } = await supabase.from('short_links').insert({
    slug,
    label: requiredText(formData, 'label'),
    target_url: target,
  });

  if (error) return fromPostgrest(error);

  revalidatePath(`/${locale}/admin/links`);
  return ok('created');
}

export async function updateShortLinkAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const slug = requiredText(formData, 'slug');
  const target = checkTarget(requiredText(formData, 'target_url'));

  if (!target) return fail('The destination must be a full address starting with https://.');

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from('short_links')
    .update({ label: requiredText(formData, 'label'), target_url: target })
    .eq('slug', slug)
    .select('slug');

  if (error) return fromPostgrest(error);
  // RLS hides the row rather than refusing, so a silent zero-row update is
  // the "not permitted" case here.
  if (!updated?.length) return fail('Nothing was saved: this link is not yours to change.');

  revalidatePath(`/${locale}/admin/links`);
  return ok();
}

export async function deleteShortLinkAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const slug = requiredText(formData, 'slug');

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from('short_links')
    .delete()
    .eq('slug', slug)
    .select('slug');

  if (error) return fromPostgrest(error);
  if (!deleted?.length) return fail('Nothing was deleted: this link is not yours to remove.');

  revalidatePath(`/${locale}/admin/links`);
  return ok();
}
