import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button, Card, EmptyState, Label, Select } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { loadDayRows, loadSessions, sessionDays, toFloorRow } from '@/lib/interviews/queries';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';
import { ReceptionBoard } from './ReceptionBoard';

/**
 * The reception desk: every company's students for one day (today by
 * default), found by phone number or name and checked in with one press.
 * Receptionists (0069), HR and managers. Checking in is the only change made
 * here; what happens inside a room is the organizers' (the Floor tab).
 */
export default async function InterviewsReceptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { locale, id } = await params;
  const { day } = await searchParams;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  if (!can.reception(role)) return <EmptyState>{tCommon('notPermitted')}</EmptyState>;

  const db = createInterviewsClient();
  const days = sessionDays(await loadSessions(db, edition.id));
  const today = toDateInput(new Date());
  const selectedDay =
    day && days.includes(day) ? day : days.includes(today) ? today : (days[0] ?? today);

  const rows = (await loadDayRows(db, edition.id, selectedDay, edition.time_zone)).map(toFloorRow);

  return (
    <div className="space-y-4">
      {days.length > 1 || selectedDay !== today ? (
        <Card>
          <form className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="day">{t('schedule.day')}</Label>
              <Select id="day" name="day" defaultValue={selectedDay}>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {formatDate(`${d}T12:00:00Z`, locale)}
                    {d === today ? ` · ${t('reception.today')}` : ''}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              {tCommon('open')}
            </Button>
          </form>
        </Card>
      ) : null}

      {days.length === 0 ? (
        <EmptyState>{t('reception.noDays')}</EmptyState>
      ) : (
        <ReceptionBoard
          // A new day is a new board: the key resets its state.
          key={selectedDay}
          locale={locale}
          projectId={id}
          initialRows={rows}
          pollUrl={`/api/interviews/floor?project=${id}&day=${selectedDay}`}
          isToday={selectedDay === today}
        />
      )}
    </div>
  );
}
