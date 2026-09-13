import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/auth/session';
import { Badge, Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatTime } from '@/lib/format';
import {
  buildWeeks,
  dayNumber,
  monthGridRange,
  monthParam,
  parseMonth,
  shiftMonth,
  type CalendarEntry,
} from '@/lib/calendar';

const DEFAULT_COLOR = { club: '#0b4f5f', meeting: '#007a8f' } as const;

/** Height of one bar and the gap under it, in pixels. */
const LANE_HEIGHT = 22;
const LANE_GAP = 2;
const DAY_NUMBER_HEIGHT = 26;

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { month: monthQuery } = await searchParams;
  const t = await getTranslations('calendar');

  const today = new Date();
  const { year, month } = parseMonth(monthQuery, today);
  const { start, end } = monthGridRange(year, month);

  // The grid is padded to whole weeks, so fetch by the padded range rather
  // than the month — an entry starting in the trailing days of the previous
  // month still has to draw here.
  const rangeStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const rangeEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);

  const supabase = await createClient();
  const { data } = await supabase
    .from('calendar_entries')
    .select(
      'id, kind, title, description, starts_at, ends_at, all_day, location, category, color, source_request_id',
    )
    .lt('starts_at', rangeEnd.toISOString())
    .gte('ends_at', rangeStart.toISOString())
    .order('starts_at');

  const entries = (data ?? []) as CalendarEntry[];
  const weeks = buildWeeks(year, month, entries);

  const canAdd = await hasPermission('calendar.manage');

  const previous = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  const intlLocale = locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB';
  const monthLabel = new Intl.DateTimeFormat(intlLocale, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month, 1));

  const weekdayFormat = new Intl.DateTimeFormat(intlLocale, { weekday: 'short' });
  const dayFormat = new Intl.DateTimeFormat(intlLocale, { day: 'numeric' });

  const todayNumber = dayNumber(today);
  const monthEntryCount = entries.filter((entry) => {
    const entryStart = new Date(entry.starts_at);
    const entryEnd = new Date(entry.ends_at);
    return (
      (entryStart.getFullYear() === year && entryStart.getMonth() === month) ||
      (entryEnd.getFullYear() === year && entryEnd.getMonth() === month)
    );
  }).length;

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          canAdd ? (
            <Link href="/calendar/new">
              <Button>{t('newEntry')}</Button>
            </Link>
          ) : null
        }
      />

      {/*
        The month, with an arrow either side. Flex follows the writing
        direction, so in Arabic "previous" sits on the right — and the
        chevrons rotate with it, so each still points the way it moves.
      */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link
          href={`/calendar?month=${monthParam(previous.year, previous.month)}`}
          aria-label={t('previousMonth')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-lg text-ink-muted hover:bg-surface-muted"
        >
          <span aria-hidden="true" className="rtl:rotate-180">‹</span>
        </Link>
        <div className="flex flex-col items-center">
          <h2 className="text-lg font-semibold text-ink">{monthLabel}</h2>
          <Link
            href={`/calendar?month=${monthParam(today.getFullYear(), today.getMonth())}`}
            className="text-xs text-brand-700 hover:underline"
          >
            {t('today')}
          </Link>
        </div>
        <Link
          href={`/calendar?month=${monthParam(next.year, next.month)}`}
          aria-label={t('nextMonth')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-lg text-ink-muted hover:bg-surface-muted"
        >
          <span aria-hidden="true" className="rtl:rotate-180">›</span>
        </Link>
      </div>

      {/* Seven columns of whatever width the screen gives — on a phone the
          bars are colour only and the list underneath carries the titles. */}
      <Card className="overflow-hidden p-0">
        <div className="min-w-0">
          <div className="grid grid-cols-7 border-b border-line bg-surface-muted">
            {weeks[0]?.days.map((day) => (
              <div
                key={day.toISOString()}
                className="px-2 py-2 text-center text-xs font-medium text-ink-muted"
              >
                {weekdayFormat.format(day)}
              </div>
            ))}
          </div>

          {weeks.map((week) => {
            const lanes = Math.max(week.laneCount, 1);
            const cellHeight =
              DAY_NUMBER_HEIGHT + lanes * (LANE_HEIGHT + LANE_GAP) + 6;

            return (
              <div key={week.days[0].toISOString()} className="relative">
                {/* Background: the day cells themselves. */}
                <div className="grid grid-cols-7">
                  {week.days.map((day) => {
                    const inMonth = day.getMonth() === month;
                    const isToday = dayNumber(day) === todayNumber;

                    return (
                      <div
                        key={day.toISOString()}
                        style={{ minHeight: cellHeight }}
                        className={`border-b border-e border-line last:border-e-0 px-1 py-1 sm:px-2 sm:py-1.5 ${
                          inMonth ? 'bg-surface' : 'bg-surface-muted/50'
                        }`}
                      >
                        <span
                          className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs ${
                            isToday
                              ? 'bg-brand-600 font-semibold text-white'
                              : inMonth
                                ? 'text-ink'
                                : 'text-ink-muted'
                          }`}
                        >
                          {dayFormat.format(day)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/*
                  Bars, overlaid on the same 7 columns. A multi-day entry is a
                  single element spanning grid columns, which is what keeps it
                  one continuous bar instead of one box per day. Grid columns
                  are logical, so this is already correct under dir="rtl".
                */}
                <div
                  className="pointer-events-none absolute inset-x-0 grid grid-cols-7 px-1"
                  style={{
                    top: DAY_NUMBER_HEIGHT,
                    gridAutoRows: `${LANE_HEIGHT}px`,
                    rowGap: `${LANE_GAP}px`,
                  }}
                >
                  {week.bars.map((bar) => {
                    const color =
                      bar.entry.color ?? DEFAULT_COLOR[bar.entry.kind] ?? DEFAULT_COLOR.club;

                    return (
                      <Link
                        key={`${bar.entry.id}-${bar.startCol}`}
                        href={`/calendar/${bar.entry.id}`}
                        title={`${bar.entry.title}${
                          bar.entry.location ? ` — ${bar.entry.location}` : ''
                        }`}
                        style={{
                          gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`,
                          gridRow: bar.lane + 1,
                          backgroundColor: color,
                          // Open the end that runs into the next week.
                          borderStartStartRadius: bar.continuesBefore ? 0 : undefined,
                          borderEndStartRadius: bar.continuesBefore ? 0 : undefined,
                          borderStartEndRadius: bar.continuesAfter ? 0 : undefined,
                          borderEndEndRadius: bar.continuesAfter ? 0 : undefined,
                        }}
                        className="pointer-events-auto mx-0.5 flex items-center gap-1 overflow-hidden rounded px-1.5 text-xs text-white"
                      >
                        {!bar.entry.all_day && !bar.continuesBefore ? (
                          <span className="ltr-nums hidden shrink-0 opacity-80 sm:inline">
                            {formatTime(bar.entry.starts_at, locale)}
                          </span>
                        ) : null}
                        <span className="hidden truncate font-medium sm:inline">{bar.entry.title}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {monthEntryCount === 0 ? (
        <div className="mt-4">
          <EmptyState>{t('noEntries')}</EmptyState>
        </div>
      ) : null}

      <ul className="mt-6 space-y-2">
        {entries
          .filter((entry) => new Date(entry.starts_at).getMonth() === month)
          .map((entry) => (
            <li key={entry.id}>
              <Card className="flex flex-wrap items-center gap-3 py-3">
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      entry.color ?? DEFAULT_COLOR[entry.kind] ?? DEFAULT_COLOR.club,
                  }}
                />
                <Link
                  href={`/calendar/${entry.id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {entry.title}
                </Link>
                <Badge tone={entry.kind === 'club' ? 'brand' : 'neutral'}>
                  {entry.kind === 'club' ? t('kindClub') : t('kindMeeting')}
                </Badge>
                {entry.source_request_id ? (
                  <Badge tone="ok">{t('fromRequest')}</Badge>
                ) : null}
                <span className="ltr-nums ms-auto text-sm text-ink-muted">
                  {formatTime(entry.starts_at, locale)} – {formatTime(entry.ends_at, locale)}
                </span>
                {entry.location ? (
                  <span className="text-sm text-ink-muted">{entry.location}</span>
                ) : null}
              </Card>
            </li>
          ))}
      </ul>
    </>
  );
}
