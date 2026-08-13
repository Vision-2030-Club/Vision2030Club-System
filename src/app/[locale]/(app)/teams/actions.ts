'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { fail, ok, requiredText, type ActionResult } from '@/lib/actions';

/**
 * Posting to a team is limited to that team's own Director(s) plus leadership.
 * That rule lives entirely in the `team_posts` RLS policy — this action just
 * inserts and reports whatever the database says.
 */
export async function createTeamPostAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const teamId = requiredText(formData, 'team_id');
  const locale = requiredText(formData, 'locale');
  const me = await getMyMember();

  const supabase = await createClient();
  const { error } = await supabase.from('team_posts').insert({
    team_id: teamId,
    author_id: me?.id ?? null,
    title: requiredText(formData, 'title'),
    body: requiredText(formData, 'body'),
  });

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/teams/${teamId}`);
  return ok();
}
