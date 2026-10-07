import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Badge, Button, Card, EmptyState, Label, Select, cx } from '@/components/ui';
import { formatDate, formatTime, localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { floorLayout, gridTimes, layoutDays, roomDay } from '@/lib/interviews/floorLayout';
import { loadCompanies, loadDayRows, loadRooms, loadSessions, sessionDays, toFloorRow } from '@/lib/interviews/queries';
import { STAGE_TONES } from '@/lib/interviews/ui';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';
import { AutoRefresh } from './AutoRefresh';
import { FloorBoard } from './FloorBoard';

/**
 * The organizer's screen, two ways:
 *
 *   - By company (the default): one company, one day, every booking in time
 *     order, and the buttons that move a student on. The list re-checks
 *     itself every twelve seconds (FloorBoard), which is how a hundred people
 *     can watch the same day without anything being pushed.
 *   - By room: every room of the day side by side, each with its whole time
 *     grid — on an event day of the edition's floor layout (Settings →
 *     Event days and hours, floorLayout.ts) that includes rooms no company is
 *     assigned to yet, as empty rows. Read only; the stage buttons stay on
 *     the company view.
 */
export default async function InterviewsFloorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ company?: string; day?: string; view?: string }>;
}) {
  const { locale, id } = await params;
  const { company, day, view } = await searchParams;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, settings, role } = access;
  const byRoom = view === 'rooms';

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  const db = createInterviewsClient();

  const [companies, sessions, rooms] = await Promise.all([
    loadCompanies(db, edition.id),
    loadSessions(db, edition.id),
    loadRooms(db, edition.id),
  ]);

  const layout = floorLayout(settings);
  const eventDays = new Set(layoutDays(layout));
  const days = [...new Set([...sessionDays(sessions), ...eventDays])].sort();
  const today = toDateInput(new Date());
  const selectedDay =
    day && days.includes(day) ? day : days.includes(today) ? today : (days[0] ?? today);

  // Only companies with a session that day are worth picking.
  const dayCompanies = companies.filter((c) =>
    sessions.some((s) => s.company_id === c.id && s.day === selectedDay),
  );
  const selectedCompany =
    dayCompanies.find((c) => c.id === company)?.id ?? dayCompanies[0]?.id ?? '';

  const base = `/projects/${id}/interviews/floor`;
  const views = (
    <div className="flex gap-2">
      {[
        { key: 'company', label: t('floor.byCompany'), href: `${base}?day=${selectedDay}` },
        { key: 'rooms', label: t('floor.byRoom'), href: `${base}?view=rooms&day=${selectedDay}` },
      ].map((v) => (
        <Link
          key={v.key}
          href={v.href}
          className={cx(
            'rounded-lg border px-3 py-1.5 text-sm',
            (v.key === 'rooms') === byRoom
              ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
              : 'border-line text-ink-muted hover:bg-surface-muted',
          )}
        >
          {v.label}
        </Link>
      ))}
    </div>
  );

  const dayPicker = (
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
  );

  if (byRoom) {
    const hidden = new Set(companies.filter((c) => c.is_hidden).map((c) => c.id));
    const rows = (await loadDayRows(db, edition.id, selectedDay, edition.time_zone)).filter((r) => !hidden.has(r.company_id));
    const grid = layout && eventDays.has(selectedDay) ? gridTimes(layout, selectedDay, edition.time_zone) : [];
    const roomIds = new Set([
      ...rows.map((r) => r.room_id),
      ...(eventDays.has(selectedDay) ? rooms.filter((r) => r.is_active).map((r) => r.id) : []),
    ]);
    const dayRooms = rooms
      .filter((r) => roomIds.has(r.id))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    return (
      <div className="space-y-4">
        <AutoRefresh seconds={15} />
        {views}
        <Card>
          <form className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="view" value="rooms" />
            {dayPicker}
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                {tCommon('open')}
              </Button>
            </div>
          </form>
        </Card>

        {dayRooms.length === 0 ? (
          <EmptyState>{t('floor.noRoomsThatDay')}</EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {dayRooms.map((room) => (
              <Card key={room.id}>
                <h2 className="font-semibold">{room.name}</h2>
                {room.note ? <p className="text-xs text-ink-muted">{room.note}</p> : null}
                <ul className="mt-3 divide-y divide-line text-sm">
                  {roomDay(
                    rows.filter((r) => r.room_id === room.id),
                    grid,
                  ).map((entry) =>
                    entry.kind === 'empty' ? (
                      <li key={`g-${entry.starts_at}`} className="flex items-center gap-3 py-1.5 text-ink-muted">
                        <span className="ltr-nums w-16 shrink-0 font-medium">{formatTime(entry.starts_at, locale)}</span>
                        <span>{t('floor.unassigned')}</span>
                      </li>
                    ) : (
                      <li key={entry.slot.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                        <span className="ltr-nums w-16 shrink-0 font-medium">{formatTime(entry.slot.starts_at, locale)}</span>
                        <span className="w-24 shrink-0 truncate text-xs text-ink-muted">
                          {localized({ name_en: entry.slot.company_name_en, name_ar: entry.slot.company_name_ar }, 'name', locale)}
                        </span>
                        {entry.slot.booking_id ? (
                          <>
                            <span className="min-w-0 flex-1 truncate">{entry.slot.student_name}</span>
                            <Badge tone={STAGE_TONES[entry.slot.stage ?? 'scheduled']}>
                              {t(`stage.${entry.slot.stage ?? 'scheduled'}`)}
                            </Badge>
                          </>
                        ) : (
                          <span className="min-w-0 flex-1 text-ink-muted">
                            {entry.slot.is_closed ? t('schedule.closed') : t('schedule.free')}
                          </span>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  const rows = selectedCompany
    ? (await loadDayRows(db, edition.id, selectedDay, edition.time_zone, selectedCompany)).map(toFloorRow)
    : [];

  return (
    <div className="space-y-4">
      {views}
      <Card>
        <form className="grid gap-3 sm:grid-cols-3">
          {dayPicker}
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
