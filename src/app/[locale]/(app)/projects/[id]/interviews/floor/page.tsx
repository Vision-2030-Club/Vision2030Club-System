import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Badge, Button, Card, EmptyState, Label, Select, cx } from '@/components/ui';
import { formatDate, formatTime, localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { floorPlan, roomDay } from '@/lib/interviews/floorLayout';
import {
  loadCompanies,
  loadDayRows,
  loadRooms,
  loadSessions,
  sessionDays,
  toFloorRow,
  withFeedbackFlags,
} from '@/lib/interviews/queries';
import { loadOrganizers, organizerOf, roomOrganizers, roomsRunBy } from '@/lib/interviews/roomOrganizers';
import { STAGE_TONES } from '@/lib/interviews/ui';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';
import { AutoRefresh } from './AutoRefresh';
import { FloorBoard } from './FloorBoard';

/**
 * The organizer's screen, three ways:
 *
 *   - My rooms (an organizer's default when they run a room that day): each
 *     room given to them on the Rooms tab (roomOrganizers.ts), every company
 *     in it, with the buttons that move a student on.
 *   - By company (everyone else's default): one company, one day, every
 *     booking in time order, and the buttons. The list re-checks itself every
 *     twelve seconds (FloorBoard), which is how a hundred people can watch
 *     the same day without anything being pushed. A row in a room another
 *     organizer runs shows whose it is and no buttons; the server refuses
 *     the move anyway (stageAction).
 *   - By room: every room of the day side by side, each with its whole time
 *     grid and its organizer — on an event day of the edition's floor layout
 *     (Settings → Event days and hours) or a day a room is in use (its own
 *     days, Rooms tab; floorPlan in floorLayout.ts) that includes rooms no
 *     company is assigned to yet, as empty rows. Read only.
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
  const { edition, settings, role, actor } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  const db = createInterviewsClient();

  const [companies, sessions, rooms, organizers] = await Promise.all([
    loadCompanies(db, edition.id),
    loadSessions(db, edition.id),
    loadRooms(db, edition.id),
    loadOrganizers(id),
  ]);

  const plan = floorPlan(settings, rooms);
  const days = [...new Set([...sessionDays(sessions), ...plan.days])].sort();
  const today = toDateInput(new Date());
  const selectedDay =
    day && days.includes(day) ? day : days.includes(today) ? today : (days[0] ?? today);

  // Who runs which room that day (Rooms tab), and which rooms are mine.
  const owners = roomOrganizers(settings);
  const nameOf = new Map(organizers.map((o) => [o.id, localized(o, 'name', locale)]));
  const roomIdsThatDay = [
    ...new Set([...sessions.filter((s) => s.day === selectedDay).map((s) => s.room_id), ...plan.roomsOn(selectedDay)]),
  ];
  const ownerName = (roomId: string) => {
    const owner = organizerOf(owners, roomId, selectedDay);
    return owner ? (nameOf.get(owner) ?? t('floor.formerOrganizer')) : null;
  };
  const myRooms = rooms
    .filter((r) => roomsRunBy(owners, actor.id, selectedDay, roomIdsThatDay).includes(r.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  // Rooms whose buttons this person must not see: another organizer's. A
  // manager may act anywhere.
  const lockedRooms = can.manage(role)
    ? []
    : roomIdsThatDay.filter((roomId) => {
        const owner = organizerOf(owners, roomId, selectedDay);
        return owner !== null && owner !== actor.id;
      });
  const lockedOwners = Object.fromEntries(lockedRooms.map((roomId) => [roomId, ownerName(roomId) ?? '']));

  const current: 'mine' | 'company' | 'rooms' =
    view === 'rooms' ? 'rooms' : view === 'company' ? 'company' : view === 'mine' || myRooms.length ? 'mine' : 'company';
  const byRoom = current === 'rooms';

  // Only companies with a session that day are worth picking.
  const dayCompanies = companies.filter((c) =>
    sessions.some((s) => s.company_id === c.id && s.day === selectedDay),
  );
  const selectedCompany =
    dayCompanies.find((c) => c.id === company)?.id ?? dayCompanies[0]?.id ?? '';

  const base = `/projects/${id}/interviews/floor`;
  const views = (
    <div className="flex flex-wrap gap-2">
      {[
        ...(myRooms.length || current === 'mine'
          ? [{ key: 'mine', label: t('floor.myRooms'), href: `${base}?view=mine&day=${selectedDay}` }]
          : []),
        { key: 'company', label: t('floor.byCompany'), href: `${base}?view=company&day=${selectedDay}` },
        { key: 'rooms', label: t('floor.byRoom'), href: `${base}?view=rooms&day=${selectedDay}` },
      ].map((v) => (
        <Link
          key={v.key}
          href={v.href}
          className={cx(
            'rounded-lg border px-3 py-1.5 text-sm',
            v.key === current
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
    const grid = plan.grid(selectedDay, edition.time_zone);
    const roomIds = new Set([...rows.map((r) => r.room_id), ...plan.roomsOn(selectedDay)]);
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
                <p className="text-xs text-ink-muted">
                  {t('floor.organizer')}: {ownerName(room.id) ?? t('floor.anyOrganizer')}
                </p>
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
                        <span className="w-24 shrink-0 truncate text-xs font-semibold text-brand-700">
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

  if (current === 'mine') {
    const boards = await Promise.all(
      myRooms.map(async (room) => ({
        room,
        rows: await withFeedbackFlags(
          db,
          (await loadDayRows(db, edition.id, selectedDay, edition.time_zone, undefined, room.id)).map(toFloorRow),
        ),
      })),
    );
    return (
      <div className="space-y-4">
        {views}
        <Card>
          <form className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="view" value="mine" />
            {dayPicker}
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                {tCommon('open')}
              </Button>
            </div>
          </form>
        </Card>
        {boards.length === 0 ? (
          <EmptyState>{t('floor.noRoomsOfMine')}</EmptyState>
        ) : (
          boards.map(({ room, rows }) => (
            <section key={room.id} className="space-y-2">
              <h2 className="font-semibold">
                {room.name}
                {room.note ? <span className="ms-2 text-xs font-normal text-ink-muted">{room.note}</span> : null}
              </h2>
              <FloorBoard
                key={`${room.id}-${selectedDay}`}
                locale={locale}
                projectId={id}
                initialRows={rows}
                pollUrl={`/api/interviews/floor?project=${id}&room=${room.id}&day=${selectedDay}`}
                canAct={can.stage(role)}
                isManager={can.manage(role)}
              />
            </section>
          ))
        )}
      </div>
    );
  }

  const rows = selectedCompany
    ? await withFeedbackFlags(
        db,
        (await loadDayRows(db, edition.id, selectedDay, edition.time_zone, selectedCompany)).map(toFloorRow),
      )
    : [];

  return (
    <div className="space-y-4">
      {views}
      <Card>
        <form className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="view" value="company" />
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
          lockedRooms={lockedOwners}
        />
      )}
    </div>
  );
}
