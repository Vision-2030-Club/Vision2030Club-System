'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';

export async function createAssetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase.from('assets').insert({
    tag: text(formData, 'tag'),
    name_en: requiredText(formData, 'name_en'),
    name_ar: requiredText(formData, 'name_ar'),
    description: text(formData, 'description'),
    status: text(formData, 'status') ?? 'available',
  });

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/assets`);
  return ok();
}

/**
 * Checks an asset out (spec §8).
 *
 * Deliberately does NOT look first to see whether the asset is free. The
 * partial unique index `asset_checkouts_one_active` is the rule, and letting
 * the insert fail against it is the only version that is still correct when
 * two people submit at the same moment. A pre-check would just widen the race.
 */
export async function checkOutAssetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const assetId = requiredText(formData, 'asset_id');
  const me = await getMyMember();
  if (!me) return fail('Not signed in');

  // Only someone with assets.manage gets to name a different holder; the
  // insert policy re-checks this regardless.
  const memberId = text(formData, 'member_id') ?? me.id;

  const supabase = await createClient();
  const { error } = await supabase.from('asset_checkouts').insert({
    asset_id: assetId,
    member_id: memberId,
    due_back_on: text(formData, 'due_back_on'),
    checked_out_by: me.id,
    note: text(formData, 'note'),
  });

  if (error) {
    if (error.message.includes('asset_checkouts_one_active')) {
      const t = await getTranslations({ locale, namespace: 'assets' });
      return fail(t('alreadyOut'));
    }
    return fail(error.message);
  }

  revalidatePath(`/${locale}/assets`);
  return ok();
}

/** Returning an asset. The trigger flips the asset back to available. */
export async function checkInAssetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const me = await getMyMember();
  const supabase = await createClient();

  const { error } = await supabase
    .from('asset_checkouts')
    .update({ returned_at: new Date().toISOString(), checked_in_by: me?.id ?? null })
    .eq('id', requiredText(formData, 'checkout_id'))
    .is('returned_at', null);

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/assets`);
  return ok();
}
