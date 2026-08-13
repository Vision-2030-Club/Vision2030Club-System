import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatDate, formatDateTime, localized } from '@/lib/format';
import { findStatus, loadStatusLookup } from '@/lib/requests';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('dashboard');
  const tNav = await getTranslations('nav');
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
      supabase
        .from('tasks')
        .select('id, title, status, due_date, task_assignees!inner(member_id)')
        .eq('task_assignees.member_id', member!.id)
        .neq('status', 'done')
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

  return (
    <>
      <PageHeader
        title={t('greeting', {
          name: locale === 'ar' ? member!.name_ar : member!.name_en,
        })}
        description={t('subtitle')}
      />

      <div className="grid gap-4 lg:grid-cols-3">
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
                  <div className="text-sm font-medium">{task.title}</div>
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
