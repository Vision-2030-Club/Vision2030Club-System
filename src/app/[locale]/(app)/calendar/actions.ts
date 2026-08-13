'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { all, fail, ok, requiredText, text, type ActionResult } from '@/lib/actions';

/**
 * Creates a calendar entry and its audience rows (spec §6).
 *
 * The two halves of the form mean different things and are handled
 * differently here:
 *
 *   scope       -> columns on calendar_entries. The insert policy re-reads it
 *                  through app.can, so asking for a team or project you may
 *                  not schedule with is refused by the database, not here.
 *   visibility  -> rows in calendar_entry_audiences. Never gated: once the
 *                  entry exists, its creator may point it at anyone.
 *
 * A cross-boundary meeting cannot be created on this path at all. It reaches
 * the calendar only through an approved Meeting Request, whose hook inserts
 * the entry as the table owner and so bypasses the insert policy.
 */
export async function createCalendarEntryAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const kind = requiredText(formData, 'kind');

  if (kind !== 'club' && kind !== 'meeting') return fail('Unknown entry kind');

  const me = await getMyMember();
  if (!me) return fail('Not signed in');

  const startsAt = requiredText(formData, 'starts_at');
  const endsAt = text(formData, 'ends_at') ?? startsAt;

  if (new Date(endsAt) < new Date(startsAt)) {
    return fail('End time must not be before the start time');
  }

  // Scope. Club events carry none at all — the table's shape constraint
  // rejects the row if these disagree with the kind.
  let scopeKind: string | null = null;
  let scopeTeam: string | null = null;
  let scopeProject: string | null = null;

  if (kind === 'meeting') {
    scopeKind = requiredText(formData, 'meeting_scope_kind');
    if (scopeKind === 'team') {
      scopeTeam = requiredText(formData, 'meeting_scope_team_id');
    } else if (scopeKind === 'project') {
      scopeProject = requiredText(formData, 'meeting_scope_project_id');
    } else if (scopeKind !== 'presidency') {
      return fail('Unknown meeting scope');
    }
  }

  const supabase = await createClient();

  const { data: entry, error } = await supabase
    .from('calendar_entries')
    .insert({
      kind,
      title: requiredText(formData, 'title'),
      description: text(formData, 'description'),
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      all_day: formData.get('all_day') === 'on',
      location: text(formData, 'location'),
      category: text(formData, 'category'),
      color: text(formData, 'color'),
      created_by: me.id,
      meeting_scope_kind: scopeKind,
      meeting_scope_team_id: scopeTeam,
      meeting_scope_project_id: scopeProject,
    })
    .select('id')
    .single();

  if (error) return fail(error.message);

  const audienceRows = buildAudienceRows(formData, entry.id);

  if (audienceRows.length) {
    const { error: audienceError } = await supabase
      .from('calendar_entry_audiences')
      .insert(audienceRows);

    // supabase-js cannot span the two inserts in one transaction, so an entry
    // nobody can see would otherwise be left behind.
    if (audienceError) {
      await supabase.from('calendar_entries').delete().eq('id', entry.id);
      return fail(audienceError.message);
    }
  }

  revalidatePath(`/${locale}/calendar`);
  return ok('created');
}

type AudienceRow = {
  entry_id: string;
  audience_kind: string;
  team_id?: string;
  project_id?: string;
  member_id?: string;
};

/**
 * The seven audience options are checkboxes and freely combinable, so this
 * fans the three parameterised ones out over their selected targets.
 */
function buildAudienceRows(formData: FormData, entryId: string): AudienceRow[] {
  const chosen = new Set(all(formData, 'audience'));
  const rows: AudienceRow[] = [];

  for (const kind of ['presidency', 'directors', 'club_management', 'all_members']) {
    if (chosen.has(kind)) rows.push({ entry_id: entryId, audience_kind: kind });
  }

  if (chosen.has('team')) {
    for (const teamId of all(formData, 'audience_team_id')) {
      rows.push({ entry_id: entryId, audience_kind: 'team', team_id: teamId });
    }
  }

  if (chosen.has('project')) {
    for (const projectId of all(formData, 'audience_project_id')) {
      rows.push({ entry_id: entryId, audience_kind: 'project', project_id: projectId });
    }
  }

  if (chosen.has('individual')) {
    for (const memberId of all(formData, 'audience_member_id')) {
      rows.push({ entry_id: entryId, audience_kind: 'individual', member_id: memberId });
    }
  }

  return rows;
}

export async function deleteCalendarEntryAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const supabase = await createClient();

  const { error } = await supabase
    .from('calendar_entries')
    .delete()
    .eq('id', requiredText(formData, 'entry_id'));

  if (error) return fail(error.message);

  revalidatePath(`/${locale}/calendar`);
  return ok();
}
