'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPermission } from '@/lib/auth/session';
import { fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import { AVATAR_BUCKET } from '@/lib/avatars';
import { toDateInput } from '@/lib/time';

/** Mirrors the bucket's own `allowed_mime_types` and size cap (migration 0024). */
const AVATAR_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

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

/**
 * Profile photo (spec addendum: a member profile carries a picture).
 *
 * The file goes to the PRIVATE `avatars` bucket under `<member_id>/…`, which
 * is the same string the bucket's policy checks — so a member uploading into
 * someone else's folder is refused by storage, not by the `if` below. The `if`
 * is here only to give that refusal a readable message.
 *
 * The stored name carries a timestamp rather than being fixed, because a fixed
 * name replaced in place keeps serving the old image from CDN and browser
 * caches long after the new one is up.
 */
export async function uploadAvatarAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = requiredText(formData, 'id');
  const locale = requiredText(formData, 'locale');
  const file = formData.get('photo');

  if (!(file instanceof File) || file.size === 0) {
    return fail('Choose an image first.');
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return fail('That image is larger than 2 MB. Please pick a smaller one.');
  }

  const extension = AVATAR_TYPES[file.type as keyof typeof AVATAR_TYPES];
  if (!extension) {
    return fail('Profile photos must be a JPEG, PNG or WebP image.');
  }

  const supabase = await createClient();
  const path = `${id}/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return fail(uploadError.message);

  /*
   * Read the old path BEFORE overwriting it, so the replaced file can be
   * deleted afterwards. Order matters the other way round too: the row is
   * pointed at the new object first, so a failure here leaves an orphaned file
   * rather than a profile pointing at one that is gone.
   */
  const { data: previousRow } = await supabase
    .from('members')
    .select('avatar_path')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase
    .from('members')
    .update({ avatar_path: path })
    .eq('id', id);

  if (error) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    return fail(error.message);
  }

  const previousPath = previousRow?.avatar_path as string | null | undefined;
  if (previousPath && previousPath !== path) {
    await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]);
  }

  revalidateMember(locale, id);
  return ok();
}

/**
 * One entry in the experience history. Ending date left empty means "still
 * there" — the table stores that as a NULL `ended_on` rather than a flag, so
 * there is only one way to say it.
 */
export async function addExperienceAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = requiredText(formData, 'id');
  const locale = requiredText(formData, 'locale');
  const startedOn = requiredText(formData, 'started_on');
  const endedOn = text(formData, 'ended_on');

  // The database refuses this too (member_experience_not_future, 0057), but
  // its answer is a constraint name; this one is a sentence.
  const today = toDateInput(new Date());
  if (startedOn > today || (endedOn && endedOn > today)) {
    return fail('Experience cannot start or end in the future.');
  }

  const supabase = await createClient();
  const { error } = await supabase.from('member_experience').insert({
    member_id: id,
    title: requiredText(formData, 'title'),
    organization: requiredText(formData, 'organization'),
    description: text(formData, 'description'),
    started_on: startedOn,
    ended_on: endedOn,
  });

  if (error) return fromPostgrest(error);

  revalidateMember(locale, id);
  return ok();
}

export async function deleteExperienceAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = requiredText(formData, 'id');
  const locale = requiredText(formData, 'locale');
  const entryId = requiredText(formData, 'entry_id');

  const supabase = await createClient();
  const { error } = await supabase.from('member_experience').delete().eq('id', entryId);
  if (error) return fromPostgrest(error);

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
