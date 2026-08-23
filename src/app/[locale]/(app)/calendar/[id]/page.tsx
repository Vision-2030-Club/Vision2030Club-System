import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, scopeFor } from '@/lib/auth/session';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { Badge, Card, PageHeader } from '@/components/ui';
import { formatDateTime, toDateTimeInput } from '@/lib/format';
import { deleteCalendarEntryAction } from '../actions';
import { EntryForm, type EntryDefaults } from '../EntryForm';
import { loadEntryFormOptions } from '../options';

type AudienceRow = {
  audience_kind: string;
  team_id: string | null;
  project_id: string | null;
  member_id: string | null;
};

export default async function CalendarEntryPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('calendar');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();
  const me = await getMyMember();

  const { data: entry } = await supabase
    .from('calendar_entries')
    .select(
      'id, kind, title, description, starts_at, ends_at, all_day, location, category, color, created_by, source_request_id, meeting_scope_kind, meeting_scope_team_id, meeting_scope_project_id',
    )
    .eq('id', id)
    .maybeSingle();

  // `calendar_entries_select` decides visibility, so a row we cannot read is
  // indistinguishable from one that does not exist — which is the right
  // answer to give either way.
  if (!entry) notFound();

  const [{ data: audienceRows }, options] = await Promise.all([
    supabase
      .from('calendar_entry_audiences')
      .select('audience_kind, team_id, project_id, member_id')
      .eq('entry_id', id),
    loadEntryFormOptions(locale),
  ]);

  const audiences = (audienceRows ?? []) as AudienceRow[];

  /*
   * Mirrors `calendar_entries_update` / `_delete`: the creator, or someone
   * whose calendar.manage scope reaches this entry's team or project. Getting
   * this wrong only shows or hides a button — both actions re-check in the
   * database and report their own refusal.
   */
  const scope = await scopeFor('calendar.manage');
  const canEdit =
    entry.created_by === me?.id ||
    scope === 'all' ||
    (scope === 'own_team' && entry.meeting_scope_team_id === me?.team_id) ||
    (scope === 'own_projects' &&
      Boolean(entry.meeting_scope_project_id) &&
      options.scopeProjects.some((p) => p.id === entry.meeting_scope_project_id));

  const defaults: EntryDefaults = {
    id: entry.id,
    kind: entry.kind as 'club' | 'meeting',
    title: entry.title,
    description: entry.description,
    // The <input type="datetime-local"> wants a local wall-clock string, not
    // the ISO instant the column holds.
    startsAt: toDateTimeInput(new Date(entry.starts_at)),
    endsAt: toDateTimeInput(new Date(entry.ends_at)),
    allDay: Boolean(entry.all_day),
    location: entry.location,
    category: entry.category,
    color: entry.color,
    meetingScopeKind: entry.meeting_scope_kind,
    meetingScopeTeamId: entry.meeting_scope_team_id,
    meetingScopeProjectId: entry.meeting_scope_project_id,
    audiences: [...new Set(audiences.map((row) => row.audience_kind))],
    audienceTeamIds: audiences.map((row) => row.team_id).filter((v): v is string => Boolean(v)),
    audienceProjectIds: audiences
      .map((row) => row.project_id)
      .filter((v): v is string => Boolean(v)),
    audienceMemberIds: audiences
      .map((row) => row.member_id)
      .filter((v): v is string => Boolean(v)),
  };

  const teamName = (teamId: string | null) =>
    options.teams.find((team) => team.id === teamId)?.label ?? '';
  const projectName = (projectId: string | null) =>
    options.projects.find((project) => project.id === projectId)?.label ?? '';
  const memberName = (memberId: string | null) =>
    options.members.find((member) => member.id === memberId)?.label ?? '';

  const audienceLabel = (row: AudienceRow) => {
    if (row.audience_kind === 'team') return `${t('audienceTeam')}: ${teamName(row.team_id)}`;
    if (row.audience_kind === 'project') {
      return `${t('audienceProject')}: ${projectName(row.project_id)}`;
    }
    if (row.audience_kind === 'individual') {
      return `${t('audienceIndividual')}: ${memberName(row.member_id)}`;
    }
    return t(
      `audience${row.audience_kind.charAt(0).toUpperCase()}${row.audience_kind.slice(1)}`,
    );
  };

  const scopeLabel =
    entry.meeting_scope_kind === 'team'
      ? `${t('scopeOwnTeam')} · ${teamName(entry.meeting_scope_team_id)}`
      : entry.meeting_scope_kind === 'project'
        ? `${t('scopeOwnProject')} · ${projectName(entry.meeting_scope_project_id)}`
        : entry.meeting_scope_kind === 'presidency'
          ? t('scopePresidency')
          : null;

  return (
    <>
      <PageHeader
        title={entry.title}
        description={`${formatDateTime(entry.starts_at, locale)} – ${formatDateTime(
          entry.ends_at,
          locale,
        )}`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={entry.kind === 'club' ? 'brand' : 'neutral'}>
          {entry.kind === 'club' ? t('kindClub') : t('kindMeeting')}
        </Badge>
        {entry.all_day ? <Badge>{t('allDay')}</Badge> : null}
        {entry.source_request_id ? <Badge tone="ok">{t('fromRequest')}</Badge> : null}
        {entry.category ? <Badge>{entry.category}</Badge> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">{t('title')}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-muted">{t('startsAt')}</dt>
            <dd>{formatDateTime(entry.starts_at, locale)}</dd>
            <dt className="text-ink-muted">{t('endsAt')}</dt>
            <dd>{formatDateTime(entry.ends_at, locale)}</dd>
            <dt className="text-ink-muted">{t('location')}</dt>
            <dd>{entry.location ?? '—'}</dd>
            {scopeLabel ? (
              <>
                <dt className="text-ink-muted">{t('scope')}</dt>
                <dd>{scopeLabel}</dd>
              </>
            ) : null}
          </dl>

          {entry.description ? (
            <p className="mt-4 border-t border-line pt-4 text-sm whitespace-pre-line text-ink">
              {entry.description}
            </p>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('visibility')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('visibilityHint')}</p>

          {audiences.length ? (
            <ul className="flex flex-wrap gap-2">
              {audiences.map((row, index) => (
                <li key={`${row.audience_kind}-${index}`}>
                  <Badge>{audienceLabel(row)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">{tCommon('none')}</p>
          )}
        </Card>
      </div>

      {canEdit ? (
        <div className="mt-4 space-y-3">
          <Disclosure label={tCommon('edit')} title={tCommon('edit')}>
            <EntryForm
              locale={locale}
              entry={defaults}
              defaultStart={defaults.startsAt}
              defaultEnd={defaults.endsAt}
              {...options}
            />
          </Disclosure>

          <ConfirmForm
            action={deleteCalendarEntryAction}
            trigger={tCommon('delete')}
            title={t('deleteTitle')}
            body={t('deleteBody')}
            confirmLabel={tCommon('delete')}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="entry_id" value={entry.id} />
          </ConfirmForm>
        </div>
      ) : null}
    </>
  );
}
