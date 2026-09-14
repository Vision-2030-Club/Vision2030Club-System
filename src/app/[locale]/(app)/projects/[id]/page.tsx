import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MemberLink } from '@/components/MemberLink';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, scopeFor } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { TaskCard } from '@/components/TaskCard';
import { StatTile } from '@/components/charts/BarList';
import { Badge, Card, EmptyState, Input, Label, PageHeader, Select } from '@/components/ui';
import { formatDate, localized } from '@/lib/format';
import {
  groupTaskRows,
  HEALTH_TONES,
  formatScore,
  healthKey,
  type ProjectHealth,
  type ProjectKpi,
  type TaskKpi,
} from '@/lib/kpi';
import {
  addProjectManagerAction,
  addProjectMemberAction,
  addSplitPersonAction,
  createSplitAction,
  deleteSplitAction,
  removeProjectPersonAction,
  removeSplitPersonAction,
} from '../actions';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('projects');
  const tTasks = await getTranslations('tasks');
  const tKpi = await getTranslations('kpi');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();
  const me = await getMyMember();
  // Whose name is a link and whose is plain text. Profiles are the
  // Presidency's and HR's (scope `all`, 0058). The profile page enforces this
  // itself; this only avoids offering a link that leads to a refusal.
  const canOpenProfiles = (await scopeFor('members.directory')) === 'all';

  const { data: project } = await supabase
    .from('projects')
    .select(
      'id, name_en, name_ar, description, status, starts_on, ends_on, owning_team_id, teams(name_en, name_ar)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!project) notFound();

  const [
    { data: managers },
    { data: staff },
    { data: taskRows },
    { data: allMembers },
    { data: pms },
    { data: splits },
    { data: splitManagers },
    { data: splitMembers },
    { data: kpiRow },
    { data: splitKpis },
  ] = await Promise.all([
    supabase
      .from('project_managers')
      .select('member_id, members(id, name_en, name_ar)')
      .eq('project_id', id),
    supabase
      .from('project_members')
      .select('member_id, members(id, name_en, name_ar)')
      .eq('project_id', id),
    supabase
      .from('task_kpi')
      .select('*')
      .eq('project_id', id)
      .order('due_date', { ascending: true, nullsFirst: false }),
    supabase.from('members').select('id, name_en, name_ar').eq('status', 'active').order('name_en'),
    // Who may be made a manager: only people holding the role (0061). The
    // database refuses anyone else; this list simply never offers them.
    supabase
      .from('members')
      .select('id, name_en, name_ar, roles!inner(key)')
      .eq('status', 'active')
      .eq('roles.key', 'project_manager')
      .order('name_en'),
    supabase.from('project_splits').select('id, name').eq('project_id', id).order('name'),
    // Filtered through the embedded split: these used to fetch the WHOLE
    // club's split membership and narrow it in JS.
    supabase
      .from('project_split_managers')
      .select('split_id, member_id, project_splits!inner(project_id)')
      .eq('project_splits.project_id', id),
    supabase
      .from('project_split_members')
      .select('split_id, member_id, project_splits!inner(project_id)')
      .eq('project_splits.project_id', id),
    // Empty unless the caller holds kpi.view for this project (§8).
    supabase.from('project_kpi').select('*').eq('project_id', id).maybeSingle(),
    supabase.from('project_split_kpi').select('*').eq('project_id', id),
  ]);

  const managerIds = new Set((managers ?? []).map((m) => m.member_id as string));
  const projectScope = await scopeFor('projects.manage');
  const canManage =
    projectScope === 'all' ||
    (projectScope === 'own_projects' && managerIds.has(me?.id ?? '')) ||
    (projectScope === 'own_team' && project.owning_team_id === me?.team_id);

  // task_kpi is one row per (task, assignee); the list wants each task once.
  const tasks = groupTaskRows((taskRows ?? []) as TaskKpi[]);
  const kpi = kpiRow as ProjectKpi | null;

  const memberName = new Map(
    (allMembers ?? []).map((m) => [m.id as string, localized(m, 'name', locale)]),
  );
  const splitName = new Map((splits ?? []).map((s) => [s.id as string, s.name as string]));
  const splitKpiById = new Map(
    (splitKpis ?? []).map((s) => [s.split_id as string, s]),
  );

  const projectLabel = localized(project, 'name', locale);

  function homeLabel(task: TaskKpi) {
    const split = task.split_id ? splitName.get(task.split_id) : null;
    return split ? `${projectLabel} · ${split}` : `${projectLabel} · ${tTasks('projectWide')}`;
  }

  /** A person may run several splits, so this is a set per split. */
  const managersOf = (splitId: string) =>
    (splitManagers ?? [])
      .filter((r) => r.split_id === splitId)
      .map((r) => r.member_id as string);
  const membersOf = (splitId: string) =>
    (splitMembers ?? [])
      .filter((r) => r.split_id === splitId)
      .map((r) => r.member_id as string);

  return (
    <>
      <PageHeader
        back={{ href: '/projects', label: tCommon('back') }}
        title={projectLabel}
        description={localized(
          project.teams as unknown as Record<string, string>,
          'name',
          locale,
        )}
      />

      {/* §6: computed live, never a number a PM typed in. */}
      {kpi ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label={t('completion')} value={formatScore(kpi.completion_pct)} />
          <StatTile
            label={t('health')}
            value={tKpi(healthKey(kpi.health))}
            tone={
              kpi.health === 'at_risk'
                ? 'danger'
                : kpi.health === 'needs_attention'
                  ? 'warn'
                  : 'ok'
            }
            hint={`${kpi.completed_tasks}/${kpi.total_tasks} ${tKpi('tasks')}`}
          />
          <StatTile
            label={tKpi('delayed')}
            value={String(kpi.delayed_tasks)}
            tone={kpi.delayed_tasks > 0 ? 'warn' : 'ok'}
          />
          <StatTile
            label={tKpi('overdue')}
            value={String(kpi.overdue_tasks)}
            tone={kpi.overdue_tasks > 0 ? 'danger' : 'ok'}
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <p className="whitespace-pre-line text-sm">{project.description ?? '—'}</p>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-muted">
            <span>
              {t('startsOn')}: {formatDate(project.starts_on, locale)}
            </span>
            <span>
              {t('endsOn')}: {formatDate(project.ends_on, locale)}
            </span>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('managers')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('managersHint')}</p>

          {managers?.length ? (
            <ul className="mb-3 space-y-1 text-sm">
              {managers.map((row) => {
                const person = row.members as unknown as Record<string, string>;
                return (
                  <li
                    key={row.member_id as string}
                    className="flex items-center justify-between"
                  >
                    <MemberLink
                      id={person.id as string}
                      viewerId={me?.id}
                      canOpenAny={canOpenProfiles}
                    >
                      {localized(person, 'name', locale)}
                    </MemberLink>
                    {canManage ? (
                      <ActionForm
                        action={removeProjectPersonAction}
                        submitLabel={t('remove')}
                        variant="secondary"
                        className="space-y-0"
                      >
                        <input type="hidden" name="project_id" value={project.id} />
                        <input
                          type="hidden"
                          name="member_id"
                          value={row.member_id as string}
                        />
                        <input type="hidden" name="table" value="project_managers" />
                        <input type="hidden" name="locale" value={locale} />
                      </ActionForm>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-ink-muted">{tCommon('none')}</p>
          )}

          {canManage ? (
            (pms ?? []).some((person) => !managerIds.has(person.id as string)) ? (
              <ActionForm action={addProjectManagerAction} submitLabel={t('addManager')}>
                <input type="hidden" name="project_id" value={project.id} />
                <input type="hidden" name="locale" value={locale} />
                <Select name="member_id" aria-label={t('addManager')} required>
                  {(pms ?? [])
                    .filter((person) => !managerIds.has(person.id as string))
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {localized(person, 'name', locale)}
                      </option>
                    ))}
                </Select>
              </ActionForm>
            ) : (
              <p className="text-xs text-ink-muted">{t('noPmsAvailable')}</p>
            )
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t('team')}</h2>
          {staff?.length ? (
            <ul className="mb-3 space-y-1 text-sm">
              {staff.map((row) => {
                const person = row.members as unknown as Record<string, string>;
                return (
                  <li
                    key={row.member_id as string}
                    className="flex items-center justify-between"
                  >
                    <MemberLink
                      id={person.id as string}
                      viewerId={me?.id}
                      canOpenAny={canOpenProfiles}
                    >
                      {localized(person, 'name', locale)}
                    </MemberLink>
                    {canManage ? (
                      <ActionForm
                        action={removeProjectPersonAction}
                        submitLabel={t('remove')}
                        variant="secondary"
                        className="space-y-0"
                      >
                        <input type="hidden" name="project_id" value={project.id} />
                        <input
                          type="hidden"
                          name="member_id"
                          value={row.member_id as string}
                        />
                        <input type="hidden" name="table" value="project_members" />
                        <input type="hidden" name="locale" value={locale} />
                      </ActionForm>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-ink-muted">{tCommon('none')}</p>
          )}

          {canManage ? (
            <ActionForm action={addProjectMemberAction} submitLabel={t('addMember')}>
              <input type="hidden" name="project_id" value={project.id} />
              <input type="hidden" name="locale" value={locale} />
              <Select name="member_id" aria-label={t('addMember')} required>
                {(allMembers ?? []).map((person) => (
                  <option key={person.id} value={person.id}>
                    {localized(person, 'name', locale)}
                  </option>
                ))}
              </Select>
            </ActionForm>
          ) : null}
        </Card>

        {/* ---- §3: splits ---- */}
        <Card className="lg:col-span-3">
          <h2 className="mb-1 font-semibold">{t('splits')}</h2>
          <p className="mb-4 text-xs text-ink-muted">{t('splitsHint')}</p>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(splits ?? []).map((split) => {
              const splitId = split.id as string;
              const pmIds = managersOf(splitId);
              const memberIds = membersOf(splitId);
              // A split's own PMs staff it, as does anyone managing the project.
              const canStaff = canManage || pmIds.includes(me?.id ?? '');
              const health = splitKpiById.get(splitId);

              return (
                <div key={splitId} className="rounded-lg border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{split.name as string}</span>
                    {health ? (
                      <Badge tone={HEALTH_TONES[health.health as ProjectHealth]}>
                        {tKpi(healthKey(health.health as ProjectHealth))}
                      </Badge>
                    ) : null}
                  </div>

                  {health ? (
                    <p className="mt-1 text-xs text-ink-muted">
                      {t('completion')}: {formatScore(health.completion_pct as number | null)} ·{' '}
                      {tKpi('tasks')}: {health.total_tasks as number} · {tKpi('delayed')}:{' '}
                      {health.delayed_tasks as number}
                    </p>
                  ) : null}

                  <div className="mt-3 text-xs">
                    <div className="font-medium text-ink-muted">{t('splitManagers')}</div>
                    <ul className="mt-1 space-y-1">
                      {pmIds.length ? (
                        pmIds.map((memberId) => (
                          <li key={memberId} className="flex items-center justify-between gap-2">
                            <span>{memberName.get(memberId) ?? memberId}</span>
                            {canManage ? (
                              <ActionForm
                                action={removeSplitPersonAction}
                                submitLabel={t('remove')}
                                variant="secondary"
                                className="space-y-0"
                              >
                                <input type="hidden" name="locale" value={locale} />
                                <input type="hidden" name="project_id" value={project.id} />
                                <input type="hidden" name="split_id" value={splitId} />
                                <input type="hidden" name="member_id" value={memberId} />
                                <input
                                  type="hidden"
                                  name="table"
                                  value="project_split_managers"
                                />
                              </ActionForm>
                            ) : null}
                          </li>
                        ))
                      ) : (
                        <li className="text-ink-muted">{tCommon('none')}</li>
                      )}
                    </ul>
                  </div>

                  <div className="mt-3 text-xs">
                    <div className="font-medium text-ink-muted">{t('splitMembers')}</div>
                    <ul className="mt-1 space-y-1">
                      {memberIds.length ? (
                        memberIds.map((memberId) => (
                          <li key={memberId} className="flex items-center justify-between gap-2">
                            <span>{memberName.get(memberId) ?? memberId}</span>
                            {canStaff ? (
                              <ActionForm
                                action={removeSplitPersonAction}
                                submitLabel={t('remove')}
                                variant="secondary"
                                className="space-y-0"
                              >
                                <input type="hidden" name="locale" value={locale} />
                                <input type="hidden" name="project_id" value={project.id} />
                                <input type="hidden" name="split_id" value={splitId} />
                                <input type="hidden" name="member_id" value={memberId} />
                                <input
                                  type="hidden"
                                  name="table"
                                  value="project_split_members"
                                />
                              </ActionForm>
                            ) : null}
                          </li>
                        ))
                      ) : (
                        <li className="text-ink-muted">{tCommon('none')}</li>
                      )}
                    </ul>
                  </div>

                  {canStaff ? (
                    <div className="mt-3 space-y-2 border-t border-line pt-3">
                      <ActionForm
                        action={addSplitPersonAction}
                        submitLabel={t('addSplitMember')}
                        variant="secondary"
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="project_id" value={project.id} />
                        <input type="hidden" name="split_id" value={splitId} />
                        <input type="hidden" name="table" value="project_split_members" />
                        <Select name="member_id" aria-label={t('addSplitMember')} required>
                          {(allMembers ?? []).map((person) => (
                            <option key={person.id} value={person.id}>
                              {localized(person, 'name', locale)}
                            </option>
                          ))}
                        </Select>
                      </ActionForm>

                      {canManage ? (
                        <>
                          <ActionForm
                            action={addSplitPersonAction}
                            submitLabel={t('addSplitManager')}
                            variant="secondary"
                          >
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="project_id" value={project.id} />
                            <input type="hidden" name="split_id" value={splitId} />
                            <input
                              type="hidden"
                              name="table"
                              value="project_split_managers"
                            />
                            <Select
                              name="member_id"
                              aria-label={t('addSplitManager')}
                              required
                            >
                              {/* A split's PMs hold the role too (0061). */}
                              {(pms ?? []).map((person) => (
                                <option key={person.id} value={person.id}>
                                  {localized(person, 'name', locale)}
                                </option>
                              ))}
                            </Select>
                          </ActionForm>

                          <ConfirmForm
                            action={deleteSplitAction}
                            trigger={t('deleteSplit')}
                            title={t('deleteSplitTitle')}
                            body={t('deleteSplitBody')}
                            confirmLabel={tCommon('delete')}
                          >
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="project_id" value={project.id} />
                            <input type="hidden" name="split_id" value={splitId} />
                          </ConfirmForm>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {canManage ? (
              <div className="rounded-lg border border-dashed border-line p-4">
                <h3 className="mb-3 text-sm font-medium">{t('newSplit')}</h3>
                <ActionForm action={createSplitAction} submitLabel={tCommon('create')}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="project_id" value={project.id} />
                  <div>
                    <Label htmlFor="split-name">{t('splitName')}</Label>
                    <Input id="split-name" name="name" required />
                  </div>
                </ActionForm>
              </div>
            ) : null}
          </div>

          {!splits?.length && !canManage ? (
            <p className="text-sm text-ink-muted">{t('noSplits')}</p>
          ) : null}
        </Card>

        <div className="space-y-3 lg:col-span-3">
          <h2 className="font-semibold">{t('tasks')}</h2>
          {tasks.length ? (
            tasks.map(({ task, assigneeIds }) => (
              <TaskCard
                key={task.id}
                task={task}
                locale={locale}
                isMine={Boolean(me && assigneeIds.includes(me.id))}
                homeLabel={homeLabel(task)}
                assigneeNames={assigneeIds.map((id) => memberName.get(id) ?? '').filter(Boolean)}
              />
            ))
          ) : (
            <EmptyState>{tTasks('empty')}</EmptyState>
          )}
        </div>
      </div>
    </>
  );
}
