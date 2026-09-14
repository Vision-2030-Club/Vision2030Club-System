import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, scopeFor } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { Disclosure } from '@/components/Disclosure';
import { ScopeFilter } from '@/components/ScopeFilter';
import { TaskCard } from '@/components/TaskCard';
import { EmptyState, Input, Label, PageHeader, Select, Textarea, cx } from '@/components/ui';
import { localized } from '@/lib/format';
import { compareTasks, groupTaskRows, type TaskKpi } from '@/lib/kpi';
import { toDateInput } from '@/lib/time';
import { createTaskAction } from './actions';

const FILTERS = ['all', 'mine', 'open', 'review'] as const;
type Filter = (typeof FILTERS)[number];

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ filter?: string; scope?: string }>;
}) {
  const { locale } = await params;
  const { filter: rawFilter, scope: rawScope } = await searchParams;
  setRequestLocale(locale);

  const filter: Filter = (FILTERS as readonly string[]).includes(rawFilter ?? '')
    ? (rawFilter as Filter)
    : 'all';

  const t = await getTranslations('tasks');
  const tCommon = await getTranslations('common');
  const tRequests = await getTranslations('requests');
  const supabase = await createClient();
  const me = await getMyMember();

  /*
   * Read through task_kpi, never `tasks`. The view is where §1's derived
   * status, §4's risk tier and the two scores come from, and it is
   * security_invoker, so the same RLS decides which rows come back.
   */
  const [{ data: rows }, { data: projects }, { data: teams }, { data: splits }, { data: members }] =
    await Promise.all([
      supabase
        .from('task_kpi')
        .select('*')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(300),
      supabase.from('projects').select('id, name_en, name_ar').order('name_en'),
      supabase.from('teams').select('id, name_en, name_ar').order('name_en'),
      supabase.from('project_splits').select('id, project_id, name').order('name'),
      supabase
        .from('members')
        .select('id, name_en, name_ar')
        .eq('status', 'active')
        .order('name_en'),
    ]);

  /*
   * Who this person may create a task FOR — not merely whether tasks.manage
   * exists for their role. A Director's scope is own_team: the database
   * refuses a project task from them whichever project the form offered,
   * and refuses another team's task the same way. The form used to list
   * every project and every team (and default to "Project"), which is how
   * "assign a task to someone" became a bare RLS error in the first round.
   */
  const taskScope = await scopeFor('tasks.manage');

  const creatableTeams =
    taskScope === 'all'
      ? (teams ?? [])
      : taskScope === 'own_team'
        ? (teams ?? []).filter((team) => team.id === me!.team_id)
        : [];

  let creatableProjects = taskScope === 'all' ? (projects ?? []) : [];
  if (taskScope === 'own_projects') {
    const { data: managed } = await supabase
      .from('project_managers')
      .select('project_id')
      .eq('member_id', me!.id);
    const managedIds = new Set((managed ?? []).map((p) => p.project_id as string));
    creatableProjects = (projects ?? []).filter((p) => managedIds.has(p.id as string));
  }

  const canCreateTeamTask = creatableTeams.length > 0;
  const canCreateProjectTask = creatableProjects.length > 0;
  const canCreate = canCreateTeamTask || canCreateProjectTask;

  // Scoped the way the database will accept: the view answers for the caller
  // (0040, widened for Project Managers in 0057 F).
  const { data: assignable } = canCreate
    ? await supabase.from('assignable_members').select('id, name_en, name_ar').order('name_en')
    : { data: [] as { id: string; name_en: string; name_ar: string }[] };

  // task_kpi is one row per (task, assignee); the list wants each task once.
  // Burning first: overdue, then by how soon it is due; finished last.
  const tasks = groupTaskRows((rows ?? []) as TaskKpi[]).sort((a, b) =>
    compareTasks(a.task, b.task),
  );

  // Whoever sees the whole club can look at one team or one project of it.
  // The scope only exists for `all`; anyone narrower already sees a slice.
  const viewScope = await scopeFor('tasks.view');
  const scope = viewScope === 'all' && rawScope ? rawScope : '';
  const [scopeKind, scopeId] = scope.split(':');

  const visible = tasks.filter(({ task, assigneeIds }) => {
    if (scopeKind === 'team' && task.team_id !== scopeId) return false;
    if (scopeKind === 'project' && task.project_id !== scopeId) return false;
    if (filter === 'mine') return me !== null && assigneeIds.includes(me.id);
    // "Open" is open TO CLAIM — nobody holds it. It used to mean "not
    // finished", which put assigned work under a label that says otherwise.
    if (filter === 'open') return assigneeIds.length === 0 && task.state === 'not_started';
    // "To review" is everything actually waiting on this viewer.
    if (filter === 'review') return task.state === 'pending_confirmation' && task.can_confirm;
    return true;
  });

  const projectName = new Map(
    (projects ?? []).map((p) => [p.id as string, localized(p, 'name', locale)]),
  );
  const teamName = new Map(
    (teams ?? []).map((x) => [x.id as string, localized(x, 'name', locale)]),
  );
  const splitName = new Map((splits ?? []).map((s) => [s.id as string, s.name as string]));
  const memberName = new Map(
    (members ?? []).map((m) => [m.id as string, localized(m, 'name', locale)]),
  );

  function homeLabel(task: TaskKpi) {
    if (task.project_id) {
      const base = projectName.get(task.project_id) ?? t('project');
      const split = task.split_id ? splitName.get(task.split_id) : null;
      return split ? `${base} · ${split}` : `${base} · ${t('projectWide')}`;
    }
    return `${t('team')}: ${teamName.get(task.team_id ?? '') ?? ''}`;
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <div className="flex flex-wrap gap-1 rounded-lg border border-line p-1 text-sm">
            {FILTERS.map((key) => (
              <Link
                key={key}
                href={`/tasks${
                  [key === 'all' ? '' : `filter=${key}`, scope ? `scope=${scope}` : '']
                    .filter(Boolean)
                    .join('&')
                    .replace(/^(.)/, '?$1')
                }`}
                className={cx(
                  'rounded px-3 py-1',
                  filter === key
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {key === 'mine' ? t('mineOnly') : t(`filter${key[0].toUpperCase()}${key.slice(1)}`)}
              </Link>
            ))}
          </div>
        }
      />

      {viewScope === 'all' ? (
        <div className="mb-4">
          <ScopeFilter
            teams={(teams ?? []) as { id: string; name_en: string; name_ar: string }[]}
            projects={(projects ?? []) as { id: string; name_en: string; name_ar: string }[]}
            value={scope}
            labels={{
              all: tCommon('all'),
              teams: tRequests('targetTeams'),
              projects: tRequests('targetProjects'),
            }}
          />
        </div>
      ) : null}

      {/*
        Creating a task is an occasional act, so it is a button rather than a
        form sitting open beside the list — which also gives the list the full
        width it wants.
      */}
      {canCreate ? (
        <div className="mb-4">
          <Disclosure label={t('newTask')}>
            <ActionForm action={createTaskAction} submitLabel={tCommon('create')}>
              <input type="hidden" name="locale" value={locale} />
              <div>
                <Label htmlFor="title">{t('taskTitle')}</Label>
                <Input id="title" name="title" required />
              </div>
              <div>
                <Label htmlFor="description">{t('description')}</Label>
                <Textarea id="description" name="description" rows={3} />
              </div>

              {/* A choice only where there is one. A Director can only ever
                  make a team task, a Project Manager only a project one. */}
              {canCreateTeamTask && canCreateProjectTask ? (
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">{t('belongsTo')}</legend>
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="belongs_to"
                        value="project"
                        defaultChecked
                        className="accent-brand-600"
                      />
                      {t('project')}
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="belongs_to"
                        value="team"
                        className="accent-brand-600"
                      />
                      {t('team')}
                    </label>
                  </div>
                </fieldset>
              ) : (
                <input
                  type="hidden"
                  name="belongs_to"
                  value={canCreateProjectTask ? 'project' : 'team'}
                />
              )}

              {canCreateProjectTask ? (
                <>
                  {creatableProjects.length === 1 ? (
                    // One project — a Project Manager running just the one is
                    // not asked; it is fixed text, the way a Director's team is.
                    <div>
                      <Label>{t('project')}</Label>
                      <input type="hidden" name="project_id" value={creatableProjects[0].id} />
                      <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
                        {localized(creatableProjects[0], 'name', locale)}
                      </div>
                    </div>
                  ) : (
                    // Several — a real choice, and one that cannot be skipped:
                    // a project task with no project matches nobody's
                    // permission, and the database said so as an RLS error.
                    <div>
                      <Label htmlFor="project_id">{t('project')}</Label>
                      <Select id="project_id" name="project_id" required defaultValue="">
                        <option value="">—</option>
                        {creatableProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {localized(project, 'name', locale)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}

                  {/* §3: a project task sits in one split, or stays project-wide. */}
                  <div>
                    <Label htmlFor="split_id">{t('split')}</Label>
                    <Select id="split_id" name="split_id" defaultValue="">
                      <option value="">{t('projectWide')}</option>
                      {(splits ?? [])
                        .filter((split) => creatableProjects.some((p) => p.id === split.project_id))
                        .map((split) => (
                          <option key={split.id} value={split.id}>
                            {`${projectName.get(split.project_id as string) ?? ''} · ${split.name}`}
                          </option>
                        ))}
                    </Select>
                  </div>
                </>
              ) : null}

              {canCreateTeamTask ? (
                creatableTeams.length === 1 ? (
                  // One team — fixed text, the way the request form shows a
                  // type's owning team, rather than a dropdown of one.
                  <div>
                    <Label>{t('team')}</Label>
                    <input type="hidden" name="team_id" value={creatableTeams[0].id} />
                    <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
                      {localized(creatableTeams[0], 'name', locale)}
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="team_id">{t('team')}</Label>
                    <Select id="team_id" name="team_id" required defaultValue="">
                      <option value="">—</option>
                      {creatableTeams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {localized(team, 'name', locale)}
                        </option>
                      ))}
                    </Select>
                  </div>
                )
              ) : null}

              <div>
                <Label htmlFor="due_date">{t('dueDate')}</Label>
                <Input id="due_date" name="due_date" type="date" min={toDateInput(new Date())} />
              </div>

              {/* Several people may hold the same task (0057 E). Nobody
                  ticked posts it for claiming. */}
              <fieldset>
                <legend className="mb-1 text-sm font-medium">{t('assignees')}</legend>
                <p className="mb-2 text-xs text-ink-muted">{t('assigneesHint')}</p>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2 text-sm">
                  {(assignable ?? []).length ? (
                    (assignable ?? []).map((person) => (
                      <label key={person.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="assignee_ids"
                          value={person.id}
                          className="accent-brand-600"
                        />
                        {localized(person, 'name', locale)}
                      </label>
                    ))
                  ) : (
                    <p className="text-ink-muted">{t('leaveUnassigned')}</p>
                  )}
                </div>
              </fieldset>
            </ActionForm>
          </Disclosure>
        </div>
      ) : null}

      <div className="space-y-3">
        {visible.length ? (
          visible.map(({ task, assigneeIds }) => (
            <TaskCard
              key={task.id}
              task={task}
              locale={locale}
              isMine={me !== null && assigneeIds.includes(me.id)}
              homeLabel={homeLabel(task)}
              assigneeNames={assigneeIds.map((id) => memberName.get(id) ?? '').filter(Boolean)}
            />
          ))
        ) : (
          <EmptyState>{t('empty')}</EmptyState>
        )}
      </div>
    </>
  );
}
