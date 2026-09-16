import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button, Card, EmptyState, Label, Select } from '@/components/ui';
import { formatDate, localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { loadCompanies, loadDayRows, loadSessions, sessionDays, toFloorRow } from '@/lib/interviews/queries';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';
import { FloorBoard } from './FloorBoard';

/**
 * The organizer's screen: one company, one day, every booking in time order,
 * and the buttons that move a student on. The list re-checks itself every
 * twelve seconds (FloorBoard), which is how a hundred people can watch the
 * same day without anything being pushed.
 */
export default async function InterviewsFloorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ company?: string; day?: string }>;
}) {
  const { locale, id } = await params;
  const { company, day } = await searchParams;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  const db = createInterviewsClient();

  const [companies, sessions] = await Promise.all([
    loadCompanies(db, edition.id),
    loadSessions(db, edition.id),
  ]);

  const days = sessionDays(sessions);
  const today = toDateInput(new Date());
  const selectedDay =
    day && days.includes(day) ? day : days.includes(today) ? today : (days[0] ?? today);

  // Only companies with a session that day are worth picking.
  const dayCompanies = companies.filter((c) =>
    sessions.some((s) => s.company_id === c.id && s.day === selectedDay),
  );
  const selectedCompany =
    dayCompanies.find((c) => c.id === company)?.id ?? dayCompanies[0]?.id ?? '';

  const rows = selectedCompany
    ? (await loadDayRows(db, edition.id, selectedDay, edition.time_zone, selectedCompany)).map(toFloorRow)
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <form className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="day">{t('schedule.day')}</Label>
            <Select id="day" name="day" defaultValue={selectedDay}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {formatDate(`${d}T12:00:00Z`, locale)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="company">{t('company')}</Label>
            <Select id="company" name="company" defaultValue={selectedCompany}>
              {dayCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {localized(c, 'name', locale)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              {tCommon('open')}
            </Button>
          </div>
        </form>
      </Card>

      {!selectedCompany ? (
        <EmptyState>{t('floor.nothingThatDay')}</EmptyState>
      ) : (
        <FloorBoard
          // A new company or day is a new board: the key resets its state.
          key={`${selectedCompany}-${selectedDay}`}
          locale={locale}
          projectId={id}
          initialRows={rows}
          pollUrl={`/api/interviews/floor?project=${id}&company=${selectedCompany}&day=${selectedDay}`}
          canAct={can.stage(role)}
          isManager={can.manage(role)}
        />
      )}
    </div>
  );
}
