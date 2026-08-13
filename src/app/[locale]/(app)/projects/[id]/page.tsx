import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, scopeFor } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, EmptyState, PageHeader, Select } from '@/components/ui';
import { formatDate, localized } from '@/lib/format';
import {
  addProjectManagerAction,
  addProjectMemberAction,
  removeProjectPersonAction,
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
  const tCommon = await getTranslations('common');
  const supabase = await createClient();
  const me = await getMyMember();

  const { data: project } = await supabase
    .from('projects')
    .select(
      'id, name_en, name_ar, description, status, starts_on, ends_on, owning_team_id, teams(name_en, name_ar)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!project) notFound();

  const [{ data: managers }, { data: staff }, { data: tasks }, { data: allMembers }] =
    await Promise.all([
      supabase
        .from('project_managers')
        .select('member_id, members(id, name_en, name_ar)')
        .eq('project_id', id),
      supabase
        .from('project_members')
        .select('member_id, members(id, name_en, name_ar)')
        .eq('project_id', id),
      supabase
        .from('tasks')
        .select('id, title, status, due_date')
        .eq('project_id', id)
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('members').select('id, name_en, name_ar').eq('status', 'active').order('name_en'),
    ]);

  const managerIds = new Set((managers ?? []).map((m) => m.member_id as string));
  const projectScope = await scopeFor('projects.manage');
  const canManage =
    projectScope === 'all' ||
    (projectScope === 'own_projects' && managerIds.has(me?.id ?? '')) ||
    (projectScope === 'own_team' && project.owning_team_id === me?.team_id);

  return (
    <>
      <PageHeader
        title={localized(project, 'name', locale)}
        description={localized(
          project.teams as unknown as Record<string, string>,
          'name',
          locale,
        )}
      />

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
                  <li key={row.member_id as string} className="flex items-center justify-between">
                    <Link
                      href={`/members/${person.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {localized(person, 'name', locale)}
                    </Link>
                    {canManage ? (
                      <ActionForm
                        action={removeProjectPersonAction}
                        submitLabel={t('remove')}
                        variant="secondary"
                        className="space-y-0"
                      >
                        <input type="hidden" name="project_id" value={project.id} />
                        <input type="hidden" name="member_id" value={row.member_id as string} />
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
            <ActionForm action={addProjectManagerAction} submitLabel={t('addManager')}>
              <input type="hidden" name="project_id" value={project.id} />
              <input type="hidden" name="locale" value={locale} />
              <Select name="member_id" aria-label={t('addManager')} required>
                {(allMembers ?? []).map((person) => (
                  <option key={person.id} value={person.id}>
                    {localized(person, 'name', locale)}
                  </option>
                ))}
              </Select>
            </ActionForm>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t('team')}</h2>
          {staff?.length ? (
            <ul className="mb-3 space-y-1 text-sm">
              {staff.map((row) => {
                const person = row.members as unknown as Record<string, string>;
                return (
                  <li key={row.member_id as string} className="flex items-center justify-between">
                    <Link
                      href={`/members/${person.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {localized(person, 'name', locale)}
                    </Link>
                    {canManage ? (
                      <ActionForm
                        action={removeProjectPersonAction}
                        submitLabel={t('remove')}
                        variant="secondary"
                        className="space-y-0"
                      >
                        <input type="hidden" name="project_id" value={project.id} />
                        <input type="hidden" name="member_id" value={row.member_id as string} />
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

        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">{t('tasks')}</h2>
          {tasks?.length ? (
            <ul className="divide-y divide-line text-sm">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between py-2">
                  <span>{task.title}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-ink-muted">
                      {formatDate(task.due_date, locale)}
                    </span>
                    <Badge tone={task.status === 'done' ? 'ok' : 'neutral'}>
                      {tTasks(
                        `status${String(task.status).charAt(0).toUpperCase()}${String(
                          task.status,
                        ).slice(1)}`,
                      )}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{tTasks('empty')}</EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}
