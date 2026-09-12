'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation';
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
type EntryFields = {
  kind: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  category: string | null;
  color: string | null;
  meeting_scope_kind: string | null;
  meeting_scope_team_id: string | null;
  meeting_scope_project_id: string | null;
};

/**
 * The columns of an entry, read out of the form.
 *
 * Create and edit post the same fields, so they read them the same way.
 * Returns a message instead of throwing on the two checks the database cannot
 * phrase readably: an unknown kind, and an end before the start.
 */
function readEntryFields(formData: FormData): EntryFields | string {
  const kind = requiredText(formData, 'kind');
  if (kind !== 'club' && kind !== 'meeting') return 'Unknown entry kind';

  const startsAt = requiredText(formData, 'starts_at');
  const endsAt = text(formData, 'ends_at') ?? startsAt;

  if (new Date(endsAt) < new Date(startsAt)) {
    return 'End time must not be before the start time';
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
      return 'Unknown meeting scope';
    }
  }

  return {
    kind,
    title: requiredText(formData, 'title'),
    description: text(formData, 'description'),
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    all_day: formData.get('all_day') === 'on',
    location: text(formData, 'location'),
    category: text(formData, 'category'),
    color: text(formData, 'color'),
    meeting_scope_kind: scopeKind,
    meeting_scope_team_id: scopeTeam,
    meeting_scope_project_id: scopeProject,
  };
}

export async function createCalendarEntryAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');

  const fields = readEntryFields(formData);
  if (typeof fields === 'string') return fail(fields);

  const me = await getMyMember();
  if (!me) return fail('Not signed in');

  const supabase = await createClient();

  const { data: entry, error } = await supabase
    .from('calendar_entries')
    .insert({ ...fields, created_by: me.id })
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
  revalidatePath(`/${locale}/dashboard`);
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

/**
 * Edits an existing entry (spec §6 — an entry can be corrected, not only
 * added).
 *
 * Two things worth knowing:
 *
 *   - Nothing here checks who may edit. `calendar_entries_update` already
 *     answers that — the creator, or someone whose `calendar.manage` scope
 *     reaches this entry's team or project — and a row this caller may not
 *     touch simply updates nothing, which is what the `select` below detects.
 *
 *   - The audience is REPLACED, not merged. The form always posts the
 *     complete set, so a merge would make unchecking a box do nothing, and
 *     nobody would notice until an entry stayed visible to a team it had been
 *     taken away from.
 */
export async function updateCalendarEntryAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const entryId = requiredText(formData, 'entry_id');

  const fields = readEntryFields(formData);
  if (typeof fields === 'string') return fail(fields);

  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from('calendar_entries')
    .update(fields)
    .eq('id', entryId)
    .select('id');

  if (error) return fail(error.message);
  if (!updated?.length) {
    return fail('Entry not found, or you are not allowed to edit it');
  }

  const { error: clearError } = await supabase
    .from('calendar_entry_audiences')
    .delete()
    .eq('entry_id', entryId);
  if (clearError) return fail(clearError.message);

  const audienceRows = buildAudienceRows(formData, entryId);
  if (audienceRows.length) {
    const { error: audienceError } = await supabase
      .from('calendar_entry_audiences')
      .insert(audienceRows);
    if (audienceError) return fail(audienceError.message);
  }

  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/dashboard`);
  revalidatePath(`/${locale}/calendar/${entryId}`);
  return ok();
}

/**
 * Deletes an entry, then leaves for the month grid.
 *
 * The redirect is the point: this is called from the entry's own page, and
 * staying there would re-render a detail view of a row that no longer exists.
 * `redirect` throws, so nothing after it runs — which is also why the audience
 * rows are left to their ON DELETE CASCADE rather than being cleared first.
 */
export async function deleteCalendarEntryAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const entryId = requiredText(formData, 'entry_id');
  const supabase = await createClient();

  const { data: deleted, error } = await supabase
    .from('calendar_entries')
    .delete()
    .eq('id', entryId)
    .select('id');

  if (error) return fail(error.message);
  if (!deleted?.length) {
    return fail('Entry not found, or you are not allowed to delete it');
  }

  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/dashboard`);
  redirect({ href: '/calendar', locale });

  // Unreachable: `redirect` throws NEXT_REDIRECT. next-intl's wrapper is not
  // typed as `never`, so the compiler still wants a return here.
  return ok();
}
