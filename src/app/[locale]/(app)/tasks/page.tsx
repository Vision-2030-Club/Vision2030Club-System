import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, hasPermission } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { Disclosure } from '@/components/Disclosure';
import { TaskCard } from '@/components/TaskCard';
import { EmptyState, Input, Label, PageHeader, Select, Textarea, cx } from '@/components/ui';
import { localized } from '@/lib/format';
import type { TaskKpi } from '@/lib/kpi';
import { createTaskAction } from './actions';

const FILTERS = ['all', 'mine', 'open', 'review'] as const;
type Filter = (typeof FILTERS)[number];

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { locale } = await params;
  const { filter: rawFilter } = await searchParams;
  setRequestLocale(locale);

  const filter: Filter = (FILTERS as readonly string[]).includes(rawFilter ?? '')
    ? (rawFilter as Filter)
    : 'all';

  const t = await getTranslations('tasks');
  const tCommon = await getTranslations('common');
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

  const tasks = (rows ?? []) as TaskKpi[];

  const visible = tasks.filter((task) => {
    if (filter === 'mine') return task.assignee_id === me?.id;
    if (filter === 'open') return task.state === 'in_progress' || task.state === 'not_started';
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

  const canCreate = await hasPermission('tasks.manage');

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
                href={key === 'all' ? '/tasks' : `/tasks?filter=${key}`}
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

              <div>
                <Label htmlFor="project_id">{t('project')}</Label>
                <Select id="project_id" name="project_id">
                  <option value="">—</option>
                  {(projects ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {localized(project, 'name', locale)}
                    </option>
                  ))}
                </Select>
              </div>

              {/* §3: a project task sits in one split, or stays project-wide. */}
              <div>
                <Label htmlFor="split_id">{t('split')}</Label>
                <Select id="split_id" name="split_id" defaultValue="">
                  <option value="">{t('projectWide')}</option>
                  {(splits ?? []).map((split) => (
                    <option key={split.id} value={split.id}>
                      {`${projectName.get(split.project_id as string) ?? ''} · ${split.name}`}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="team_id">{t('team')}</Label>
                <Select id="team_id" name="team_id">
                  <option value="">—</option>
                  {(teams ?? []).map((team) => (
                    <option key={team.id} value={team.id}>
                      {localized(team, 'name', locale)}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="due_date">{t('dueDate')}</Label>
                <Input id="due_date" name="due_date" type="date" />
              </div>

              {/* One assignee per task, so §5's per-person average is
                  unambiguous. Leaving it empty posts the task for claiming. */}
              <div>
                <Label htmlFor="assignee_id">{t('assignee')}</Label>
                <Select id="assignee_id" name="assignee_id" defaultValue="">
                  <option value="">{t('leaveUnassigned')}</option>
                  {(members ?? []).map((person) => (
                    <option key={person.id} value={person.id}>
                      {localized(person, 'name', locale)}
                    </option>
                  ))}
                </Select>
              </div>
            </ActionForm>
          </Disclosure>
        </div>
      ) : null}

      <div className="space-y-3">
        {visible.length ? (
          visible.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              locale={locale}
              meId={me?.id ?? null}
              homeLabel={homeLabel(task)}
              assigneeName={task.assignee_id ? (memberName.get(task.assignee_id) ?? null) : null}
            />
          ))
        ) : (
          <EmptyState>{t('empty')}</EmptyState>
        )}
      </div>
    </>
  );
}
