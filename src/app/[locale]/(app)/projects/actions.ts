'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';

export async function createProjectAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const me = await getMyMember();
  const supabase = await createClient();

  const { error } = await supabase.from('projects').insert({
    name_en: requiredText(formData, 'name_en'),
    name_ar: requiredText(formData, 'name_ar'),
    description: text(formData, 'description'),
    owning_team_id: requiredText(formData, 'owning_team_id'),
    status: text(formData, 'status') ?? 'active',
    starts_on: text(formData, 'starts_on'),
    ends_on: text(formData, 'ends_on'),
    created_by: me?.id ?? null,
  });

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects`);
  return ok();
}

/**
 * Staffing is independent of a person's home team, so any member can be added
 * to any project (spec §1).
 */
export async function addProjectMemberAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase
    .from('project_members')
    .insert({ project_id: projectId, member_id: requiredText(formData, 'member_id') });

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

/**
 * Up to 4 Project Managers. The limit is a trigger in the database, so this
 * action simply surfaces the error it raises rather than counting first.
 */
export async function addProjectManagerAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const memberId = requiredText(formData, 'member_id');
  const supabase = await createClient();

  const { error } = await supabase
    .from('project_managers')
    .insert({ project_id: projectId, member_id: memberId });

  if (error) return fail(error.message);

  // A manager who isn't already on the project team should be.
  await supabase
    .from('project_members')
    .upsert(
      { project_id: projectId, member_id: memberId },
      { onConflict: 'project_id,member_id', ignoreDuplicates: true },
    );

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

export async function removeProjectPersonAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const memberId = requiredText(formData, 'member_id');
  const table = requiredText(formData, 'table');

  if (table !== 'project_members' && table !== 'project_managers') {
    return fail('Unknown table');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('project_id', projectId)
    .eq('member_id', memberId);

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

// -----------------------------------------------------------------------------
// §3 — Splits
//
// Optional per project. A split has a free-text name, one or more PMs who
// confirm its tasks, and its own roster — and a person may sit in several
// splits of the same project, which is unrelated to the club-wide "one team per
// member" rule.
// -----------------------------------------------------------------------------

export async function createSplitAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const me = await getMyMember();
  const supabase = await createClient();

  const { error } = await supabase.from('project_splits').insert({
    project_id: projectId,
    name: requiredText(formData, 'name'),
    created_by: me?.id ?? null,
  });

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

export async function addSplitPersonAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const splitId = requiredText(formData, 'split_id');
  const memberId = requiredText(formData, 'member_id');
  const table = requiredText(formData, 'table');

  if (table !== 'project_split_members' && table !== 'project_split_managers') {
    return fail('Unknown table');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from(table)
    .insert({ split_id: splitId, member_id: memberId });

  if (error) return fail(error.message);

  // A split PM needs to be on the split's roster and on the project itself,
  // otherwise they cannot see the work they are responsible for.
  if (table === 'project_split_managers') {
    await supabase
      .from('project_split_members')
      .upsert(
        { split_id: splitId, member_id: memberId },
        { onConflict: 'split_id,member_id', ignoreDuplicates: true },
      );
  }
  await supabase
    .from('project_members')
    .upsert(
      { project_id: projectId, member_id: memberId },
      { onConflict: 'project_id,member_id', ignoreDuplicates: true },
    );

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

export async function removeSplitPersonAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const table = requiredText(formData, 'table');

  if (table !== 'project_split_members' && table !== 'project_split_managers') {
    return fail('Unknown table');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('split_id', requiredText(formData, 'split_id'))
    .eq('member_id', requiredText(formData, 'member_id'));

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

/**
 * Deleting a split does NOT delete its tasks — `tasks.split_id` is ON DELETE
 * SET NULL, so they fall back to project-wide and the project's PMs become
 * their confirmers. No score is touched, which matters because §7's "no way to
 * preserve a score by deleting" cuts both ways: no way to lose one either.
 */
export async function deleteSplitAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase
    .from('project_splits')
    .delete()
    .eq('id', requiredText(formData, 'split_id'));

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

// -----------------------------------------------------------------------------
// Components (0062)
//
// A project can carry ONE component — today, Mock Interviews — whose data
// lives in a separate database. Attaching creates (or re-links) that
// database's edition for the project, then records the link here. The club
// database's policy on `project_components` is what decides who may do this;
// nothing below re-checks a role.
// -----------------------------------------------------------------------------

export async function attachComponentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const componentKey = requiredText(formData, 'component_key');

  if (componentKey === 'outreach') {
    // Outreach (0065) lives in this database: the link row is the whole of
    // attaching. Three starter types so the page is usable at once; managers
    // rename or replace them on the page.
    const me = await getMyMember();
    if (!me) return fail('Not signed in');
    const supabase = await createClient();
    const { error } = await supabase.from('project_components').insert({
      project_id: projectId,
      component_key: componentKey,
      external_ref: null,
      attached_by: me.id,
    });
    // A project may carry both components (0066), but not the same one twice.
    if (error?.code === '23505') return fail('This project already has Outreach.');
    if (error) return fail(error.message);
    await supabase.from('outreach_types').upsert(
      [
        { project_id: projectId, key: 'sponsor', name_en: 'Sponsor', name_ar: 'راعٍ', sort_order: 10 },
        { project_id: projectId, key: 'speaker', name_en: 'Speaker', name_ar: 'متحدث', sort_order: 20 },
        { project_id: projectId, key: 'venue', name_en: 'Venue', name_ar: 'مكان', sort_order: 30 },
      ],
      { onConflict: 'project_id,key', ignoreDuplicates: true },
    );
    revalidatePath(`/${locale}/projects/${projectId}`);
    return ok();
  }

  if (componentKey !== 'mock_interviews') return fail('Unknown component.');

  const { isInterviewsConfigured, createInterviewsClient } = await import('@/lib/supabase/interviews');
  if (!isInterviewsConfigured()) {
    return fail(
      'The Mock Interviews database is not configured on this server (INTERVIEWS_SUPABASE_URL / INTERVIEWS_SUPABASE_SERVICE_ROLE_KEY).',
    );
  }

  const me = await getMyMember();
  if (!me) return fail('Not signed in');
  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, name_en, name_ar')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return fail('No such project.');

  const db = createInterviewsClient();
  const actor = { kind: 'member', id: me.id, name: me.name_en };
  const link = (editionId: string, projectRef: string) =>
    db.rpc('update_edition', {
      p_edition: editionId,
      p_patch: { club_project_id: projectRef },
      p_actor: actor,
    });

  /*
   * Which edition this project shows. "new" starts one named after the
   * project; anything else is an existing edition nobody else holds — the
   * archived April 2026 week, or an edition a detached project left behind.
   * A project that once held an edition finds it again by club_project_id.
   */
  const choice = text(formData, 'edition_id') ?? 'new';
  let editionId: string | undefined;
  let created = false;
  let linked = false;

  if (choice !== 'new') {
    const { data: chosen } = await db
      .from('editions')
      .select('id, club_project_id')
      .eq('id', choice)
      .maybeSingle();
    if (!chosen) return fail('That edition no longer exists.');
    if (chosen.club_project_id && chosen.club_project_id !== projectId) {
      return fail('That edition is attached to another project.');
    }
    if (chosen.club_project_id !== projectId) {
      const { error } = await link(chosen.id as string, projectId);
      if (error) return fail(error.message);
      linked = true;
    }
    editionId = chosen.id as string;
  } else {
    const { data: existing } = await db
      .from('editions')
      .select('id')
      .eq('club_project_id', projectId)
      .maybeSingle();
    editionId = existing?.id as string | undefined;

    if (!editionId) {
      const { newToken } = await import('@/lib/interviews/tokens');
      const { data: edition, error } = await db.rpc('create_edition', {
        p_payload: {
          name_en: project.name_en,
          name_ar: project.name_ar,
          public_slug: await uniqueSlug(db, project.name_en as string),
          club_project_id: projectId,
          tv_token: newToken(),
        },
        p_actor: actor,
      });
      if (error) return fail(error.message);
      editionId = (edition as { id: string }).id;
      created = true;
    }
  }

  const { error } = await supabase.from('project_components').insert({
    project_id: projectId,
    component_key: componentKey,
    external_ref: editionId,
    attached_by: me.id,
  });

  if (error) {
    // Refused by the club database: leave the other database as it was.
    if (created) await db.from('editions').delete().eq('id', editionId);
    else if (linked) await link(editionId, '');
    return fail(error.message);
  }

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

/** Removes the link only. The edition and every row in it stay where they are. */
export async function detachComponentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  // Which component to detach — a project may carry two (0066). An older
  // form that sends none detaches the interviews one, as it always did.
  const componentKey = text(formData, 'component_key') ?? 'mock_interviews';

  const { data: deleted, error } = await supabase
    .from('project_components')
    .delete()
    .eq('project_id', projectId)
    .eq('component_key', componentKey)
    .select('project_id, component_key, external_ref');

  if (error) return fail(error.message);
  if (!deleted?.length) return fail('Nothing to detach, or you may not manage this project.');

  // The edition and its data stay; only the link goes. Clearing the back
  // reference lets another project pick the edition up from the list.
  // Outreach keeps its rows in this database and has no edition to release.
  if (deleted[0].component_key !== 'mock_interviews') {
    revalidatePath(`/${locale}/projects/${projectId}`);
    return ok();
  }

  const { isInterviewsConfigured, createInterviewsClient } = await import('@/lib/supabase/interviews');
  const editionId = deleted[0].external_ref as string | null;
  if (editionId && isInterviewsConfigured()) {
    const me = await getMyMember();
    await createInterviewsClient().rpc('update_edition', {
      p_edition: editionId,
      p_patch: { club_project_id: '' },
      p_actor: { kind: 'member', id: me?.id ?? null, name: me?.name_en ?? 'member' },
    });
  }

  revalidatePath(`/${locale}/projects/${projectId}`);
  return ok();
}

/**
 * The apply-form URL segment, from the project's English name: lowercase,
 * dashes, and a year, made unique against the editions that already exist.
 */
async function uniqueSlug(db: SupabaseClient, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'mock-interviews';
  const year = new Date().getFullYear();

  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? `${base}-${year}` : `${base}-${year}-${n + 1}`;
    const { data } = await db.from('editions').select('id').eq('public_slug', candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${Date.now()}`;
}
