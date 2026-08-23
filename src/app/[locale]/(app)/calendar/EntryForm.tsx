'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Alert, Input, Label, Select, Textarea } from '@/components/ui';
import { createCalendarEntryAction, updateCalendarEntryAction } from './actions';

export type Option = { id: string; label: string };

/**
 * An existing entry being edited. Absent when creating one.
 *
 * `audiences` is the flat set of chosen audience KINDS, with the three
 * parameterised ones carrying their selected ids alongside — the same split
 * the form itself works in, so nothing has to be reshaped on the way in.
 */
export type EntryDefaults = {
  id: string;
  kind: 'club' | 'meeting';
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  category: string | null;
  color: string | null;
  meetingScopeKind: string | null;
  meetingScopeTeamId: string | null;
  meetingScopeProjectId: string | null;
  audiences: string[];
  audienceTeamIds: string[];
  audienceProjectIds: string[];
  audienceMemberIds: string[];
};

/**
 * Create and edit are the same form.
 *
 * The only differences are which action it posts to, what the button says,
 * and whether the fields start empty — so they are parameters rather than a
 * second component that would drift out of step the first time §6's scope
 * and visibility rules change.
 *
 * The two controls that must not be conflated (spec §6):
 *
 *   "Meeting with"    — scope. Limited to what this person may schedule
 *                       directly; anything else is a Meeting Request.
 *   "Who can see it"  — visibility. Seven freely combinable checkboxes,
 *                       never gated by anyone's permission.
 *
 * Keeping them visually separate in the form is the point — a Director
 * widening who can *see* a team meeting is not asking to meet those people.
 */
export function EntryForm({
  locale,
  entry,
  canCreateClubEvent,
  scopeTeams,
  scopeProjects,
  canMeetPresidency,
  teams,
  projects,
  members,
  defaultStart,
  defaultEnd,
}: {
  locale: string;
  /** Omit to create; pass an entry to edit it. */
  entry?: EntryDefaults;
  canCreateClubEvent: boolean;
  scopeTeams: Option[];
  scopeProjects: Option[];
  canMeetPresidency: boolean;
  teams: Option[];
  projects: Option[];
  members: Option[];
  defaultStart: string;
  defaultEnd: string;
}) {
  const t = useTranslations('calendar');
  const tCommon = useTranslations('common');

  const [kind, setKind] = useState<'club' | 'meeting'>(
    entry?.kind ?? (canCreateClubEvent ? 'club' : 'meeting'),
  );

  const availableScopes = [
    scopeTeams.length ? 'team' : null,
    scopeProjects.length ? 'project' : null,
    canMeetPresidency ? 'presidency' : null,
  ].filter(Boolean) as string[];

  const [scopeKind, setScopeKind] = useState(
    entry?.meetingScopeKind ?? availableScopes[0] ?? '',
  );
  const [audiences, setAudiences] = useState<Set<string>>(
    new Set(entry ? entry.audiences : ['all_members']),
  );

  const toggleAudience = (value: string) => {
    setAudiences((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const audienceOptions: { value: string; label: string }[] = [
    { value: 'presidency', label: t('audiencePresidency') },
    { value: 'directors', label: t('audienceDirectors') },
    { value: 'club_management', label: t('audienceClub_management') },
    { value: 'all_members', label: t('audienceAll_members') },
    { value: 'team', label: t('audienceTeam') },
    { value: 'project', label: t('audienceProject') },
    { value: 'individual', label: t('audienceIndividual') },
  ];

  return (
    <ActionForm
      action={entry ? updateCalendarEntryAction : createCalendarEntryAction}
      submitLabel={entry ? tCommon('save') : tCommon('create')}
      successText={entry ? undefined : t('created')}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="kind" value={kind} />
      {entry ? <input type="hidden" name="entry_id" value={entry.id} /> : null}

      {canCreateClubEvent ? (
        <div>
          <Label>{t('entryKind')}</Label>
          <div className="flex gap-4 text-sm">
            {(['club', 'meeting'] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="kind_choice"
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {value === 'club' ? t('kindClub') : t('kindMeeting')}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <Label htmlFor="title">{t('entryTitle')}</Label>
        <Input id="title" name="title" defaultValue={entry?.title ?? ''} required />
      </div>

      <div>
        <Label htmlFor="description">{t('description')}</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={entry?.description ?? ''}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="starts_at">{t('startsAt')}</Label>
          <Input
            id="starts_at"
            name="starts_at"
            type="datetime-local"
            defaultValue={entry?.startsAt ?? defaultStart}
            required
          />
        </div>
        <div>
          <Label htmlFor="ends_at">{t('endsAt')}</Label>
          <Input
            id="ends_at"
            name="ends_at"
            type="datetime-local"
            defaultValue={entry?.endsAt ?? defaultEnd}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="all_day" defaultChecked={entry?.allDay ?? false} />
        {t('allDay')}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="location">{t('location')}</Label>
          <Input id="location" name="location" defaultValue={entry?.location ?? ''} />
        </div>
        <div>
          <Label htmlFor="category">{t('category')}</Label>
          <Input id="category" name="category" defaultValue={entry?.category ?? ''} />
        </div>
      </div>

      <div>
        <Label htmlFor="color">{t('color')}</Label>
        <Input
          id="color"
          name="color"
          type="color"
          defaultValue={entry?.color ?? '#007a8f'}
          className="h-10"
        />
      </div>

      {/* ---- Scope: what may need approval ---- */}
      {kind === 'meeting' ? (
        <fieldset className="rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-medium text-ink">{t('scope')}</legend>
          <p className="mb-3 text-xs text-ink-muted">{t('scopeHint')}</p>

          {availableScopes.length === 0 ? (
            <NeedsRequestNotice />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-4 text-sm">
                {availableScopes.includes('team') ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="meeting_scope_kind"
                      value="team"
                      checked={scopeKind === 'team'}
                      onChange={() => setScopeKind('team')}
                    />
                    {t('scopeOwnTeam')}
                  </label>
                ) : null}
                {availableScopes.includes('project') ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="meeting_scope_kind"
                      value="project"
                      checked={scopeKind === 'project'}
                      onChange={() => setScopeKind('project')}
                    />
                    {t('scopeOwnProject')}
                  </label>
                ) : null}
                {availableScopes.includes('presidency') ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="meeting_scope_kind"
                      value="presidency"
                      checked={scopeKind === 'presidency'}
                      onChange={() => setScopeKind('presidency')}
                    />
                    {t('scopePresidency')}
                  </label>
                ) : null}
              </div>

              {scopeKind === 'team' ? (
                <Select
                  name="meeting_scope_team_id"
                  defaultValue={entry?.meetingScopeTeamId ?? undefined}
                  required
                >
                  {scopeTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.label}
                    </option>
                  ))}
                </Select>
              ) : null}

              {scopeKind === 'project' ? (
                <Select
                  name="meeting_scope_project_id"
                  defaultValue={entry?.meetingScopeProjectId ?? undefined}
                  required
                >
                  {scopeProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.label}
                    </option>
                  ))}
                </Select>
              ) : null}

              <NeedsRequestNotice />
            </div>
          )}
        </fieldset>
      ) : null}

      {/* ---- Visibility: never gated ---- */}
      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-medium text-ink">{t('visibility')}</legend>
        <p className="mb-3 text-xs text-ink-muted">{t('visibilityHint')}</p>

        <div className="space-y-2">
          {audienceOptions.map((option) => (
            <div key={option.value}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="audience"
                  value={option.value}
                  checked={audiences.has(option.value)}
                  onChange={() => toggleAudience(option.value)}
                />
                {option.label}
              </label>

              {option.value === 'team' && audiences.has('team') ? (
                <MultiSelect
                  name="audience_team_id"
                  options={teams}
                  selected={entry?.audienceTeamIds}
                />
              ) : null}
              {option.value === 'project' && audiences.has('project') ? (
                <MultiSelect
                  name="audience_project_id"
                  options={projects}
                  selected={entry?.audienceProjectIds}
                />
              ) : null}
              {option.value === 'individual' && audiences.has('individual') ? (
                <MultiSelect
                  name="audience_member_id"
                  options={members}
                  selected={entry?.audienceMemberIds}
                />
              ) : null}
            </div>
          ))}
        </div>
      </fieldset>
    </ActionForm>
  );
}

/**
 * Shown whenever the meeting scope control is on screen — including when it
 * offers nothing at all. Scheduling with anyone outside your own team or
 * projects is not a permission you can be granted here; it is a request.
 */
function NeedsRequestNotice() {
  const t = useTranslations('calendar');

  return (
    <Alert tone="info">
      {t('needsRequest')}{' '}
      <Link href="/requests/new" className="font-medium underline">
        {t('fileMeetingRequest')}
      </Link>
    </Alert>
  );
}

function MultiSelect({
  name,
  options,
  selected,
}: {
  name: string;
  options: Option[];
  selected?: string[];
}) {
  return (
    <Select
      name={name}
      multiple
      defaultValue={selected}
      className="mt-2 h-32"
      required
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
