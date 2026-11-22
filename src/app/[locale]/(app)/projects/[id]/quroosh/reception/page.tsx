import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StatTile } from '@/components/charts/BarList';
import { Alert, Badge, Card, PageHeader } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { can, getEventAttendanceAccess } from '@/lib/eventAttendance/access';
import { getAttendeesById, listCheckIns } from '@/lib/eventAttendance/api';
import { eventDay } from '@/lib/eventAttendance/links';
import type { EventSummary } from '@/lib/eventAttendance/types';
import { formatTime, localized } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { ReceptionDesk } from './ReceptionDesk';

/** One person who came in today, as the desk sees them: no full mobile, no email. */
type Arrival = { id: string; name: string; phoneTail: string; at: string; via: 'scan' | 'manual' };

/** The most arrivals listed; the count above the list is always the whole day's. */
const SHOWN = 300;

/**
 * Today's arrivals, newest first, or null when they cannot be read (club
 * 0076 not applied). Read with the service role through Event attendance's
 * API, so the page must have decided who is looking before calling this.
 *
 * `since` is midnight UTC of the day before: earlier than the start of
 * today on the club's clock in any zone, so nothing of today is missed, and
 * the day itself is matched exactly below.
 */
async function todaysArrivals(projectId: string, today: string): Promise<Arrival[] | null> {
  try {
    const [year, month, date] = today.split('-').map(Number);
    const since = new Date(Date.UTC(year, month - 1, date - 1)).toISOString();
    const checkIns = (await listCheckIns(projectId, since))
      .filter((row) => row.day === today && row.undone_at === null)
      .sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at))
      .slice(0, SHOWN);
    const people = new Map(
      (await getAttendeesById(projectId, checkIns.map((row) => row.attendee_id))).map((person) => [person.id, person]),
    );
    return checkIns.flatMap((row) => {
      const person = people.get(row.attendee_id);
      return person
        ? [{ id: row.id, name: person.name, phoneTail: person.phone.slice(-4), at: row.checked_in_at, via: row.via }]
        : [];
    });
  } catch {
    return null;
  }
}

/**
 * Quroosh's reception desk: the event's attendees arriving today. For the
 * project's managers and the HR team, the people who work the gate (Event
 * attendance, 0075), so it asks Event attendance who is looking, not Quroosh.
 *
 * It is the gate without a camera, for a desk with a laptop: how many have
 * come and how many are still expected, finding a person by name or the end
 * of their mobile and checking them in, and who has arrived today. Nothing
 * is stored by this page: every check-in is Event attendance's.
 */
export default async function QurooshReceptionPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getEventAttendanceAccess(id);
  if (!access || !can.scan(access.role)) notFound();

  const t = await getTranslations('quroosh.reception');
  const header = <PageHeader title={t('title')} description={localized(access.project, 'name', locale)} />;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('event_attendance_summary', { p_project: id });
  if (error || !data) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('notReady')}</Alert>
      </>
    );
  }
  const summary = data as EventSummary;
  const arrivals = await todaysArrivals(id, summary.today);
  // Someone whose pass was cancelled after they came in is still counted as in.
  const expected = Math.max(0, summary.attendees - summary.checked_in_today);
  const outsideDays =
    summary.first_day !== null &&
    summary.last_day !== null &&
    (summary.today < summary.first_day || summary.today > summary.last_day);

  return (
    <div className="space-y-6">
      {header}

      {outsideDays ? <Alert tone="warn">{t('notAnEventDay')}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label={t('arrivedToday')}
          value={String(summary.checked_in_today)}
          tone="ok"
          hint={eventDay(summary.today, locale)}
        />
        <StatTile label={t('expected')} value={String(expected)} />
        <StatTile label={t('registered')} value={String(summary.attendees)} />
      </div>

      <ReceptionDesk projectId={id} locale={locale} />

      <p className="text-sm text-ink-muted">
        {t('scannerHint')}{' '}
        <Link href={`/projects/${id}/event-attendance/scan`} className="font-medium text-brand-600 hover:underline">
          {t('scannerLink')}
        </Link>
      </p>

      <Card>
        <h2 className="mb-3 font-semibold text-ink">{t('arrivals.title')}</h2>
        {arrivals === null ? (
          <p className="text-sm text-ink-muted">{t('arrivals.unavailable')}</p>
        ) : arrivals.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('arrivals.none')}</p>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {arrivals.map((arrival) => (
                <li key={arrival.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="font-medium text-ink">{arrival.name}</span>
                  <span className="ltr-nums text-ink-muted" dir="ltr">
                    ••• {arrival.phoneTail}
                  </span>
                  <span className="ms-auto flex items-center gap-3">
                    {arrival.via === 'manual' ? <Badge>{t('arrivals.manual')}</Badge> : null}
                    <span className="ltr-nums tabular-nums text-ink-muted">{formatTime(arrival.at, locale)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {summary.checked_in_today > arrivals.length ? (
              <p className="mt-3 text-xs text-ink-muted">{t('arrivals.more', { count: arrivals.length })}</p>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
