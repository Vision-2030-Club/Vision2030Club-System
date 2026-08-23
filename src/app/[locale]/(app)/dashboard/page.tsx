import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { Badge, Card, EmptyState, PageHeader, cx } from '@/components/ui';
import {
  HEALTH_TONES,
  RISK_CLASSES,
  formatScore,
  healthKey,
  riskKey,
  type ProjectHealth,
  type TaskRisk,
} from '@/lib/kpi';
import { formatDate, formatDateTime, localized } from '@/lib/format';
import { findStatus, loadStatusLookup } from '@/lib/requests';

type ManagedProject = {
  id: string;
  name_en: string;
  name_ar: string;
  status: string;
  ends_on: string | null;
};

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('dashboard');
  const tNav = await getTranslations('nav');
  const tTasks = await getTranslations('tasks');
  const tProjects = await getTranslations('projects');
  const tKpi = await getTranslations('kpi');
  const member = await getMyMember();
  const supabase = await createClient();

  // Every query below is filtered by RLS, so "what this person may see" is
  // decided in the database — we never add a role check here.
  const [{ data: upcoming }, { data: myTasks }, { data: myRequests }] =
    await Promise.all([
      supabase
        .from('calendar_entries')
        .select('id, kind, title, starts_at, ends_at, all_day, location, category')
        .gte('ends_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(6),
      // task_kpi carries §1's derived state; there is no status column to
      // filter on any more, so "still on my plate" means not yet terminal.
      supabase
        .from('task_kpi')
        .select('id, title, due_date, state, risk')
        .eq('assignee_id', member!.id)
        .not('state', 'in', '("completed","not_done")')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(6),
      supabase
        .from('requests')
        .select('id, status, created_at, request_type_id, request_types(name_en, name_ar)')
        .eq('submitted_by', member!.id)
        .order('created_at', { ascending: false })
        .limit(6),
    ]);

  const statuses = await loadStatusLookup(
    supabase,
    (myRequests ?? []).map((r) => r.request_type_id as string),
  );

  /*
   * The dashboard is shaped by the role, not padded out for everyone. A
   * Project Manager runs a handful of projects and little else, so theirs come
   * to the front page and the club-wide project list drops out of their menu
   * (see the app layout) rather than being a second place to look.
   *
   * `project_managers` — not `project_members` — is the source: managing a
   * project and being staffed on one are different things everywhere else in
   * the system, and conflating them here would put a PM's colleagues'
   * projects on their dashboard.
   */
  const isProjectManager = member!.role_key === 'project_manager';

  const { data: managed } = isProjectManager
    ? await supabase
        .from('project_managers')
        .select('projects(id, name_en, name_ar, status, ends_on)')
        .eq('member_id', member!.id)
    : { data: null };

  const myProjects = (managed ?? [])
    .map((row) => row.projects as unknown as ManagedProject | null)
    .filter((project): project is ManagedProject => Boolean(project));

  // project_kpi is where §6's live health and completion come from; it is
  // never recomputed here.
  const { data: projectKpis } = myProjects.length
    ? await supabase
        .from('project_kpi')
        .select('project_id, completion_pct, health')
        .in(
          'project_id',
          myProjects.map((project) => project.id),
        )
    : { data: null };

  const kpiByProject = new Map(
    (projectKpis ?? []).map((row) => [
      row.project_id as string,
      row as { completion_pct: number | null; health: ProjectHealth },
    ]),
  );

  return (
    <>
      <PageHeader
        title={t('greeting', {
          name: locale === 'ar' ? member!.name_ar : member!.name_en,
        })}
        description={t('subtitle')}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* The projects this person runs, in place of a menu entry they would
            only ever use to find these same rows. */}
        {isProjectManager ? (
          <Card className="lg:col-span-3">
            <h2 className="mb-3 font-semibold">{t('myProjects')}</h2>

            {myProjects.length ? (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {myProjects.map((project) => {
                  const projectKpi = kpiByProject.get(project.id);
                  return (
                    <li
                      key={project.id}
                      className="rounded-lg border border-line p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/projects/${project.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {localized(project, 'name', locale)}
                        </Link>
                        {projectKpi ? (
                          <Badge tone={HEALTH_TONES[projectKpi.health]}>
                            {tKpi(healthKey(projectKpi.health))}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-2 flex items-baseline justify-between text-xs text-ink-muted">
                        <span>
                          {tProjects('completion')}:{' '}
                          <span className="tabular-nums text-ink">
                            {formatScore(projectKpi?.completion_pct ?? null)}
                          </span>
                        </span>
                        {project.ends_on ? (
                          <span>
                            {tProjects('endsOn')}: {formatDate(project.ends_on, locale)}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState>{t('noProjects')}</EmptyState>
            )}
          </Card>
        ) : null}

        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{t('upcoming')}</h2>
            <Link href="/calendar" className="text-sm text-brand-600 hover:underline">
              {tNav('calendar')}
            </Link>
          </div>

          {upcoming?.length ? (
            <ul className="divide-y divide-line">
              {upcoming.map((entry) => (
                <li key={entry.id} className="flex items-baseline gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{entry.title}</div>
                    <div className="text-xs text-ink-muted">
                      {formatDateTime(entry.starts_at, locale)}
                      {entry.location ? ` · ${entry.location}` : ''}
                    </div>
                  </div>
                  <Badge tone={entry.kind === 'club' ? 'brand' : 'neutral'}>
                    {t(entry.kind === 'club' ? 'clubEntry' : 'meeting')}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{t('noUpcoming')}</EmptyState>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t('myTasks')}</h2>
          {myTasks?.length ? (
            <ul className="divide-y divide-line">
              {myTasks.map((task) => (
                <li key={task.id} className="py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium">{task.title}</div>
                    <span
                      className={cx(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                        RISK_CLASSES[task.risk as TaskRisk],
                      )}
                    >
                      {tTasks(riskKey(task.risk as TaskRisk))}
                    </span>
                  </div>
                  <div className="text-xs text-ink-muted">
                    {task.due_date ? formatDate(task.due_date, locale) : t('noDueDate')}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{t('noTasks')}</EmptyState>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{t('myRequests')}</h2>
            <Link href="/requests" className="text-sm text-brand-600 hover:underline">
              {tNav('requests')}
            </Link>
          </div>

          {myRequests?.length ? (
            <ul className="divide-y divide-line">
              {myRequests.map((request) => {
                const type = request.request_types as unknown as Record<string, string>;
                const status = findStatus(
                  statuses,
                  request.request_type_id as string,
                  request.status as string,
                );
                return (
                  <li key={request.id} className="flex items-center gap-3 py-2.5">
                    <Link
                      href={`/requests/${request.id}`}
                      className="min-w-0 flex-1 text-sm font-medium hover:underline"
                    >
                      {localized(type, 'name', locale)}
                    </Link>
                    <span className="text-xs text-ink-muted">
                      {formatDateTime(request.created_at, locale)}
                    </span>
                    <Badge tone={status?.is_terminal ? 'neutral' : 'warn'}>
                      {localized(status, 'name', locale) || request.status}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>{t('noRequests')}</EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}
