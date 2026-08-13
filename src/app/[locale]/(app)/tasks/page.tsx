import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, hasPermission } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import {
  Badge,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui';
import { formatDate, localized } from '@/lib/format';
import { createTaskAction } from './actions';

const STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;

function statusKey(status: string) {
  return `status${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mine?: string }>;
}) {
  const { locale } = await params;
  const { mine } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('tasks');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();
  const me = await getMyMember();

  let query = supabase
    .from('tasks')
    .select(
      'id, title, description, status, due_date, project_id, team_id, projects(name_en, name_ar), teams(name_en, name_ar), task_assignees(member_id, members(id, name_en, name_ar))',
    )
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(200);

  if (mine === '1') {
    query = query.eq('task_assignees.member_id', me!.id).not('task_assignees', 'is', null);
  }

  const [{ data: tasks }, { data: projects }, { data: teams }, { data: members }] =
    await Promise.all([
      query,
      supabase.from('projects').select('id, name_en, name_ar').order('name_en'),
      supabase.from('teams').select('id, name_en, name_ar').order('name_en'),
      supabase
        .from('members')
        .select('id, name_en, name_ar')
        .eq('status', 'active')
        .order('name_en'),
    ]);

  const canCreate = await hasPermission('tasks.manage');

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <div className="flex gap-1 rounded-lg border border-line p-1 text-sm">
            <Link
              href="/tasks"
              className={
                mine === '1'
                  ? 'rounded px-3 py-1 text-ink-muted'
                  : 'rounded bg-brand-50 px-3 py-1 font-medium text-brand-700'
              }
            >
              {tCommon('all')}
            </Link>
            <Link
              href="/tasks?mine=1"
              className={
                mine === '1'
                  ? 'rounded bg-brand-50 px-3 py-1 font-medium text-brand-700'
                  : 'rounded px-3 py-1 text-ink-muted'
              }
            >
              {t('mineOnly')}
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {tasks?.length ? (
            tasks.map((task) => {
              const assignees = (task.task_assignees ?? []) as unknown as {
                members: Record<string, string>;
              }[];
              return (
                <Card key={task.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{task.title}</div>
                      <div className="text-xs text-ink-muted">
                        {task.project_id
                          ? `${t('project')}: ${localized(
                              task.projects as unknown as Record<string, string>,
                              'name',
                              locale,
                            )}`
                          : `${t('team')}: ${localized(
                              task.teams as unknown as Record<string, string>,
                              'name',
                              locale,
                            )}`}
                        {task.due_date ? ` · ${formatDate(task.due_date, locale)}` : ''}
                      </div>
                    </div>
                    <Badge tone={task.status === 'done' ? 'ok' : 'neutral'}>
                      {t(statusKey(String(task.status)))}
                    </Badge>
                  </div>

                  {task.description ? (
                    <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">
                      {task.description}
                    </p>
                  ) : null}

                  {assignees.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {assignees.map((row) => (
                        <Badge key={row.members?.id} tone="brand">
                          {localized(row.members, 'name', locale)}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </Card>
              );
            })
          ) : (
            <EmptyState>{t('empty')}</EmptyState>
          )}
        </div>

        {canCreate ? (
          <Card>
            <h2 className="mb-3 font-semibold">{t('newTask')}</h2>
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

              <div>
                <Label htmlFor="status">{t('status')}</Label>
                <Select id="status" name="status" defaultValue="todo">
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(statusKey(status))}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="assignee_id">{t('assignees')}</Label>
                <Select id="assignee_id" name="assignee_id" multiple size={6}>
                  {(members ?? []).map((person) => (
                    <option key={person.id} value={person.id}>
                      {localized(person, 'name', locale)}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-ink-muted">{t('assigneesHint')}</p>
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
