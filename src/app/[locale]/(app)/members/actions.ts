'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPermission } from '@/lib/auth/session';
import { all, fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';

function revalidateMember(locale: string, id: string) {
  revalidatePath(`/${locale}/members/${id}`);
  revalidatePath(`/${locale}/members`);
}

/**
 * Profile edits. The database decides who may do this: the `members` UPDATE
 * policy plus the column gate trigger, which blocks team/role/ID changes for
 * anyone without the right permission even if this code let them through.
 */
export async function updateMemberAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = requiredText(formData, 'id');
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const patch: Record<string, string | null> = {
    name_en: requiredText(formData, 'name_en'),
    name_ar: requiredText(formData, 'name_ar'),
    phone: text(formData, 'phone'),
    college: text(formData, 'college'),
    academic_level: text(formData, 'academic_level'),
    graduation_term: text(formData, 'graduation_term'),
  };

  // Only sent by forms rendered for someone who can manage members; the
  // trigger rejects them otherwise.
  const teamId = text(formData, 'team_id');
  if (teamId) patch.team_id = teamId;
  const status = text(formData, 'status');
  if (status) patch.status = status;

  const { error } = await supabase.from('members').update(patch).eq('id', id);
  if (error) return fail(error.message);

  revalidateMember(locale, id);
  return ok();
}

/**
 * Role changes (spec §2). Gated twice: `roles.configure` here for a clear
 * message, and the trigger in the database, which also writes the audit row.
 */
export async function changeRoleAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = requiredText(formData, 'id');
  const locale = requiredText(formData, 'locale');
  const roleId = requiredText(formData, 'role_id');

  if (!(await hasPermission('roles.configure'))) {
    return fail('Permission denied: roles.configure');
  }

  const supabase = await createClient();
  const { error } = await supabase.from('members').update({ role_id: roleId }).eq('id', id);
  if (error) return fail(error.message);

  revalidateMember(locale, id);
  return ok();
}

/** Skill assignment — available to whoever can edit member records (spec §4). */
export async function setSkillsAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = requiredText(formData, 'id');
  const locale = requiredText(formData, 'locale');
  const skillIds = all(formData, 'skill_id');

  const supabase = await createClient();
  const { error: deleteError } = await supabase
    .from('member_skills')
    .delete()
    .eq('member_id', id);
  if (deleteError) return fail(deleteError.message);

  if (skillIds.length > 0) {
    const { error } = await supabase
      .from('member_skills')
      .insert(skillIds.map((skill_id) => ({ member_id: id, skill_id })));
    if (error) return fail(error.message);
  }

  revalidateMember(locale, id);
  return ok();
}

/**
 * The ONLY password reset in the system (spec §5): a Super Admin action.
 * There is no self-service flow and no reset email anywhere.
 *
 * This is one of exactly two places the service-role key is used, because
 * changing another person's credentials cannot be expressed as a query made
 * by that person.
 */
export async function resetPasswordAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = requiredText(formData, 'id');
  const password = requiredText(formData, 'password');

  if (!(await hasPermission('roles.configure'))) {
    return fail('Permission denied: roles.configure');
  }
  if (password.length < 8) {
    return fail('Password must be at least 8 characters.');
  }

  const admin = createAdminClient();
  const { data: member } = await admin
    .from('members')
    .select('auth_user_id')
    .eq('id', id)
    .maybeSingle();

  if (!member?.auth_user_id) {
    return fail('This member has not signed in yet, so there is no password to reset.');
  }

  const { error } = await admin.auth.admin.updateUserById(member.auth_user_id, {
    password,
  });
  if (error) return fail(error.message);

  return ok('passwordReset');
}

export async function updateSensitiveAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = requiredText(formData, 'id');
  const locale = requiredText(formData, 'locale');
  const nationalId = requiredText(formData, 'national_id');

  if (!/^[12][0-9]{9}$/.test(nationalId)) {
    return fail('National ID must be exactly 10 digits and start with 1 or 2.');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('member_sensitive')
    .upsert({ member_id: id, national_id: nationalId }, { onConflict: 'member_id' });

  if (error) return fromPostgrest(error);

  revalidateMember(locale, id);
  return ok();
}
