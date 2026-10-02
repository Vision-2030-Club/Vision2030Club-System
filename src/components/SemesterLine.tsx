import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, cx } from '@/components/ui';
import { formatDate, localized, toDateInput } from '@/lib/format';
import { semesterPosition, type ClubSemesterKpi } from '@/lib/semester';

/**
 * One line across the top of the dashboard: which semester it is, how far
 * through it the club is, this semester's tasks by state, and the next club
 * date on the calendar.
 *
 * The counts come from `club_semester_kpi`, read under the caller's own
 * policies, so a member sees their slice and the Presidency sees the club.
 * Until migration 0067 is applied the view does not exist and the line is
 * simply absent, per the database rules.
 */
export async function SemesterLine({ locale }: { locale: string }) {
  const t = await getTranslations('dashboard');
  const supabase = await createClient();

  const [{ data: semester, error }, { data: next }] = await Promise.all([
    supabase.from('club_semester_kpi').select('*').maybeSingle(),
    supabase
      .from('calendar_entries')
      .select('id, title, starts_at')
      .eq('kind', 'club')
      .gte('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (error || !semester) return null;

  const kpi = semester as unknown as ClubSemesterKpi;
  const position = semesterPosition(kpi.starts_on, kpi.ends_on, toDateInput(new Date()));

  const whereWeAre =
    position.phase === 'before'
      ? t('semesterBefore', { date: formatDate(kpi.starts_on, locale) })
      : position.phase === 'after'
        ? t('semesterAfter', { date: formatDate(kpi.ends_on, locale) })
        : t('semesterWeek', { week: position.week, weeks: position.weeks });

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-semibold">{localized(kpi, 'name', locale)}</h2>
        <span className="text-sm text-ink-muted">
          {whereWeAre}
          <span className="mx-2" aria-hidden="true">
            ·
          </span>
          <span className="ltr-nums">
            {formatDate(kpi.starts_on, locale)} – {formatDate(kpi.ends_on, locale)}
          </span>
        </span>
      </div>

      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-label={whereWeAre}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position.progress * 100)}
      >
        <div
          className="h-full rounded-full bg-brand-600"
          style={{ width: `${Math.round(position.progress * 100)}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-muted">
        <span>
          {t('semesterTasks', {
            completed: kpi.completed_tasks,
            planned: kpi.planned_tasks,
          })}
        </span>
        <span className={cx(kpi.overdue_tasks > 0 && 'font-medium text-danger')}>
          {t('semesterOverdue', { count: kpi.overdue_tasks })}
        </span>
        {next ? (
          <Link href="/calendar" className="hover:underline">
            {t('semesterNext', {
              title: next.title as string,
              date: formatDate(next.starts_at as string, locale),
            })}
          </Link>
        ) : (
          <span>{t('semesterNoNext')}</span>
        )}
      </div>
    </Card>
  );
}
