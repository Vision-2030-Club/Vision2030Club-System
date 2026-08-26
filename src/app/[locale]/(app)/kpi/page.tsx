import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { MemberLink } from '@/components/MemberLink';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, hasPermission } from '@/lib/auth/session';
import { BarList, StatTile, type BarRow } from '@/components/charts/BarList';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatDate, localized } from '@/lib/format';
import {
  CHART_BRAND,
  HEALTH_TONES,
  RISK_COLORS,
  RISK_TIERS,
  formatScore,
  healthKey,
  qualityKey,
  riskKey,
  stateKey,
  type MemberKpi,
  type ProjectKpi,
  type TaskKpi,
} from '@/lib/kpi';

/**
 * The KPI dashboard (§9).
 *
 * Presents everything in BOTH forms, because the addendum is explicit that
 * neither alone is sufficient: charts for trend and comparison, tables for the
 * underlying rows a viewer can scan and drill into.
 *
 * There is no permission logic in this file beyond deciding what to render.
 * Every view it reads already excludes rows the caller may not see — including,
 * always, their own (§8) — so an unauthorised visitor simply gets empty result
 * sets rather than a filtered-in-the-UI version of the truth.
 */
export default async function KpiPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('kpi');
  const tTasks = await getTranslations('tasks');
  const supabase = await createClient();
  const me = await getMyMember();

  if (!(await hasPermission('kpi.view'))) {
    return (
      <>
        <PageHeader title={t('title')} description={t('subtitle')} />
        <Alert tone="info">{t('noAccess')}</Alert>
      </>
    );
  }

  // Whose name is a link and whose is plain text. The profile page enforces
  // this itself; this only avoids offering a link that leads to a refusal.
  const canOpenProfiles = await hasPermission('members.directory');

  const [
    { data: memberRows },
    { data: projectRows },
    { data: splitRows },
    { data: projectMemberRows },
    { data: taskRows },
    { data: members },
    { data: projects },
    { data: teams },
  ] = await Promise.all([
    supabase.from('member_kpi').select('*'),
    supabase.from('project_kpi').select('*'),
    supabase.from('project_split_kpi').select('*'),
    supabase.from('project_member_kpi').select('*'),
    supabase
      .from('task_kpi')
      .select('*')
      .not('state', 'in', '("not_started","in_progress")')
      .order('confirmed_at', { ascending: false, nullsFirst: false })
      .limit(100),
    supabase.from('members').select('id, name_en, name_ar, team_id'),
    supabase.from('projects').select('id, name_en, name_ar'),
    supabase.from('teams').select('id, name_en, name_ar'),
  ]);

  const memberKpis = (memberRows ?? []) as MemberKpi[];
  const projectKpis = (projectRows ?? []) as ProjectKpi[];
  const tasks = (taskRows ?? []) as TaskKpi[];

  const memberName = new Map(
    (members ?? []).map((m) => [m.id as string, localized(m, 'name', locale)]),
  );
  const memberTeam = new Map((members ?? []).map((m) => [m.id as string, m.team_id as string]));
  const projectName = new Map(
    (projects ?? []).map((p) => [p.id as string, localized(p, 'name', locale)]),
  );
  const teamName = new Map(
    (teams ?? []).map((x) => [x.id as string, localized(x, 'name', locale)]),
  );

  if (memberKpis.length === 0 && projectKpis.length === 0) {
    return (
      <>
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState>{t('empty')}</EmptyState>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Headline figures. A single number does not need a chart.
  // ---------------------------------------------------------------------------
  const scored = memberKpis.filter((m) => m.scored_tasks > 0);
  const clubAverage =
    scored.length > 0
      ? scored.reduce((sum, m) => sum + Number(m.performance ?? 0), 0) / scored.length
      : null;
  const atRiskProjects = projectKpis.filter((p) => p.health === 'at_risk').length;

  // ---------------------------------------------------------------------------
  // Chart rows
  // ---------------------------------------------------------------------------
  const performanceRows: BarRow[] = scored
    .slice()
    .sort((a, b) => Number(b.performance ?? 0) - Number(a.performance ?? 0))
    .map((m) => ({
      key: m.member_id,
      label: memberName.get(m.member_id) ?? m.member_id,
      meta: teamName.get(memberTeam.get(m.member_id) ?? '') ?? undefined,
      value: Number(m.performance ?? 0),
      display: formatScore(m.performance),
      color: CHART_BRAND,
      labelWrapper: (label) => (
        <MemberLink
                    id={m.member_id as string}
                    viewerId={me?.id}
                    canOpenAny={canOpenProfiles}
                  >
          {label}
        </MemberLink>
      ),
    }));

  // §4's tiers, one labelled row each — identity comes from the label, so the
  // same-family reds never have to be told apart by hue.
  const riskRows: BarRow[] = RISK_TIERS.map((tier) => ({
    key: tier,
    label: tTasks(riskKey(tier)),
    value: memberKpis.reduce(
      (sum, m) =>
        sum +
        (tier === 'high'
          ? m.high_risk_tasks
          : tier === 'overdue'
            ? m.overdue_tasks
            : 0),
      0,
    ),
    display: '',
    color: RISK_COLORS[tier],
  }));

  // Delayed is the union (Medium + High + Overdue), so Medium alone is the
  // remainder once the sharper tiers are taken out.
  const totalDelayed = memberKpis.reduce((s, m) => s + m.delayed_tasks, 0);
  const totalHigh = memberKpis.reduce((s, m) => s + m.high_risk_tasks, 0);
  const totalOverdue = memberKpis.reduce((s, m) => s + m.overdue_tasks, 0);
  const totalOnTrack = memberKpis.reduce(
    (s, m) => s + (m.in_progress_tasks + m.pending_tasks - m.delayed_tasks),
    0,
  );
  const riskCounts: Record<(typeof RISK_TIERS)[number], number> = {
    low: Math.max(totalOnTrack, 0),
    medium: Math.max(totalDelayed - totalHigh - totalOverdue, 0),
    high: totalHigh,
    overdue: totalOverdue,
  };
  for (const row of riskRows) {
    row.value = riskCounts[row.key as (typeof RISK_TIERS)[number]];
    row.display = String(row.value);
  }

  const completionRows: BarRow[] = projectKpis
    .slice()
    .sort((a, b) => Number(b.completion_pct ?? 0) - Number(a.completion_pct ?? 0))
    .map((p) => ({
      key: p.project_id,
      label: projectName.get(p.project_id) ?? p.project_id,
      value: Number(p.completion_pct ?? 0),
      display: p.completion_pct === null ? '—' : formatScore(p.completion_pct),
      color: CHART_BRAND,
      meta: `${p.completed_tasks}/${p.total_tasks} ${t('tasks')}`,
      labelWrapper: (label) => (
        <Link href={`/projects/${p.project_id}`} className="text-brand-700 hover:underline">
          {label}
        </Link>
      ),
    }));

  // §6: who specifically is behind — not just that something is.
  const behindMembers = memberKpis.filter((m) => m.health !== 'on_track');
  const behindSplits = (splitRows ?? []).filter(
    (s) => (s.health as string) !== 'on_track' && (s.total_tasks as number) > 0,
  );

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <Alert tone="info">{t('ownHidden')}</Alert>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t('clubAverage')}
          value={clubAverage === null ? '—' : formatScore(Number(clubAverage.toFixed(1)))}
        />
        <StatTile label={t('totalMembers')} value={String(scored.length)} />
        <StatTile
          label={t('atRiskProjects')}
          value={String(atRiskProjects)}
          tone={atRiskProjects > 0 ? 'danger' : 'ok'}
        />
        <StatTile
          label={t('overdue')}
          value={String(riskCounts.overdue)}
          tone={riskCounts.overdue > 0 ? 'danger' : 'ok'}
        />
      </div>

      {/* ---- Charts ---- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 font-semibold">{t('chartPerformance')}</h2>
          <p className="mb-4 text-xs text-ink-muted">{t('chartHint')}</p>
          <BarList rows={performanceRows} max={100} emptyText={t('empty')} />
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('chartRisk')}</h2>
          <p className="mb-4 text-xs text-ink-muted">{t('chartRiskHint')}</p>
          <BarList rows={riskRows} emptyText={t('empty')} />
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-4 font-semibold">{t('chartCompletion')}</h2>
          <BarList rows={completionRows} max={100} emptyText={t('empty')} />
        </Card>
      </div>

      {/* ---- Falling behind (§6) ---- */}
      <Card className="mt-4">
        <h2 className="mb-1 font-semibold">{t('fallingBehind')}</h2>
        <p className="mb-3 text-xs text-ink-muted">{t('fallingBehindHint')}</p>

        {behindMembers.length === 0 && behindSplits.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('nobodyBehind')}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {behindMembers.map((m) => (
              <li key={m.member_id} className="flex flex-wrap items-center gap-3 py-2">
                <MemberLink
                  id={m.member_id as string}
                  viewerId={me?.id}
                  canOpenAny={canOpenProfiles}
                  className="font-medium"
                >
                  {memberName.get(m.member_id) ?? m.member_id}
                </MemberLink>
                <span className="text-xs text-ink-muted">
                  {t('delayed')}: {m.delayed_tasks} · {t('overdue')}: {m.overdue_tasks} ·{' '}
                  {t('completed')}: {m.completed_tasks}
                </span>
                <span className="ms-auto">
                  <Badge tone={HEALTH_TONES[m.health]}>{t(healthKey(m.health))}</Badge>
                </span>
              </li>
            ))}
            {behindSplits.map((s) => (
              <li key={s.split_id as string} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium">
                  {projectName.get(s.project_id as string) ?? ''} · {s.name as string}
                </span>
                <span className="text-xs text-ink-muted">
                  {t('delayed')}: {s.delayed_tasks as number} · {t('overdue')}:{' '}
                  {s.overdue_tasks as number}
                </span>
                <span className="ms-auto">
                  <Badge tone={HEALTH_TONES[s.health as 'at_risk']}>
                    {t(healthKey(s.health as 'at_risk'))}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---- Tables: the same data, scannable and sortable by eye ---- */}
      <Card className="mt-4 overflow-x-auto p-0">
        <h2 className="px-5 pt-5 font-semibold">{t('byMember')}</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="border-y border-line bg-surface-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t('member')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('team')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('performance')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('scored')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('completed')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('notDone')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('delayed')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('overdue')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('health')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {memberKpis.map((m) => (
              <tr key={m.member_id} className="hover:bg-surface-muted">
                <td className="px-4 py-2.5">
                  <MemberLink
                    id={m.member_id as string}
                    viewerId={me?.id}
                    canOpenAny={canOpenProfiles}
                    className="font-medium"
                  >
                    {memberName.get(m.member_id) ?? m.member_id}
                  </MemberLink>
                </td>
                <td className="px-4 py-2.5">
                  {teamName.get(memberTeam.get(m.member_id) ?? '') ?? '—'}
                </td>
                <td className="px-4 py-2.5 font-medium tabular-nums">
                  {formatScore(m.performance)}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{m.scored_tasks}</td>
                <td className="px-4 py-2.5 tabular-nums">{m.completed_tasks}</td>
                <td className="px-4 py-2.5 tabular-nums">{m.not_done_tasks}</td>
                <td className="px-4 py-2.5 tabular-nums">{m.delayed_tasks}</td>
                <td className="px-4 py-2.5 tabular-nums">{m.overdue_tasks}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={HEALTH_TONES[m.health]}>{t(healthKey(m.health))}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="mt-4 overflow-x-auto p-0">
        <h2 className="px-5 pt-5 font-semibold">{t('byProject')}</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="border-y border-line bg-surface-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t('project')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('performance')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('tasks')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('completed')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('delayed')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('highRisk')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('health')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {projectKpis.map((p) => (
              <tr key={p.project_id} className="hover:bg-surface-muted">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/projects/${p.project_id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {projectName.get(p.project_id) ?? p.project_id}
                  </Link>
                </td>
                <td className="px-4 py-2.5 font-medium tabular-nums">
                  {formatScore(p.completion_pct)}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{p.total_tasks}</td>
                <td className="px-4 py-2.5 tabular-nums">{p.completed_tasks}</td>
                <td className="px-4 py-2.5 tabular-nums">{p.delayed_tasks}</td>
                <td className="px-4 py-2.5 tabular-nums">{p.high_risk_tasks}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={HEALTH_TONES[p.health]}>{t(healthKey(p.health))}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {projectMemberRows?.length ? (
        <Card className="mt-4 overflow-x-auto p-0">
          <h2 className="px-5 pt-5 font-semibold">{t('bySplit')}</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="border-y border-line bg-surface-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('project')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('member')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('performance')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('delayed')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('overdue')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('health')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {projectMemberRows.map((row) => (
                <tr
                  key={`${row.project_id}:${row.member_id}`}
                  className="hover:bg-surface-muted"
                >
                  <td className="px-4 py-2.5">
                    {projectName.get(row.project_id as string) ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {memberName.get(row.member_id as string) ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {formatScore(row.performance as number | null)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{row.delayed_tasks as number}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.overdue_tasks as number}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={HEALTH_TONES[row.health as 'on_track']}>
                      {t(healthKey(row.health as 'on_track'))}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      <Card className="mt-4 overflow-x-auto p-0">
        <h2 className="px-5 pt-5 font-semibold">{t('recentTasks')}</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="border-y border-line bg-surface-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t('task')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('member')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{tTasks('dueDate')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{tTasks('quality')}</th>
              <th className="px-4 py-2.5 text-start font-medium">
                {tTasks('completionScore')}
              </th>
              <th className="px-4 py-2.5 text-start font-medium">{tTasks('overallScore')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tasks.map((task) => (
              <tr key={task.id} className="hover:bg-surface-muted">
                <td className="px-4 py-2.5">
                  {task.title}
                  <span className="ms-2 text-xs text-ink-muted">
                    {tTasks(stateKey(task.state))}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {task.assignee_id ? (memberName.get(task.assignee_id) ?? '—') : '—'}
                </td>
                <td className="px-4 py-2.5">{formatDate(task.due_date, locale)}</td>
                <td className="px-4 py-2.5">
                  {task.quality ? tTasks(qualityKey(task.quality)) : '—'}
                </td>
                <td className="px-4 py-2.5 tabular-nums">
                  {formatScore(task.completion_score)}
                </td>
                <td className="px-4 py-2.5 font-medium tabular-nums">
                  {/* Null here means the viewer is barred (§8) — their own work. */}
                  {task.assignee_id === me?.id && task.overall_score === null
                    ? tTasks('scoreHidden')
                    : formatScore(task.overall_score)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
