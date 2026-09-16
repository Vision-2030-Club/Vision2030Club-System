import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { Badge, Card, EmptyState, Input, Label, Select, cx } from '@/components/ui';
import { formatDate, formatTime, localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { loadCompanies, loadDayRows, loadRooms, loadSessions, sessionDays } from '@/lib/interviews/queries';
import { buildDayGrid, minuteOfDayIn } from '@/lib/interviews/schedule';
import { STAGE_TONES } from '@/lib/interviews/ui';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';
import {
  createSessionAction,
  deleteSessionAction,
  extendSessionAction,
  setSlotClosedAction,
  upsertRoomAction,
} from '../actions';

const SLOT_LENGTHS = [5, 10, 15, 20, 25, 30, 40, 45, 60];

/**
 * The schedule: rooms across, the day down, one block per session; below it,
 * the selected session's slots with who holds each. Managers create sessions
 * (the generator), extend or delete them, and close single slots; everyone
 * else reads.
 */
export default async function InterviewsSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ day?: string; session?: string }>;
}) {
  const { locale, id } = await params;
  const { day, session: selectedSessionId } = await searchParams;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, role } = access;
  const manage = can.manage(role);

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  const db = createInterviewsClient();

  const [rooms, companies, sessions] = await Promise.all([
    loadRooms(db, edition.id),
    loadCompanies(db, edition.id),
    loadSessions(db, edition.id),
  ]);

  const days = sessionDays(sessions);
  const today = toDateInput(new Date());
  const selectedDay =
    day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : days.includes(today) ? today : (days[0] ?? today);

  const dayRows = await loadDayRows(db, edition.id, selectedDay, edition.time_zone);
  const perSession = new Map<string, { total: number; booked: number }>();
  for (const row of dayRows) {
    const s = perSession.get(row.session_id) ?? { total: 0, booked: 0 };
    if (!row.is_closed) s.total += 1;
    if (row.booking_id) s.booked += 1;
    perSession.set(row.session_id, s);
  }

  const companyName = new Map(companies.map((c) => [c.id, localized(c, 'name', locale)]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));

  const daySessions = sessions
    .filter((s) => s.day === selectedDay)
    .map((s) => ({
      ...s,
      startMinute: minuteOfDayIn(s.starts_at, edition.time_zone),
      endMinute: minuteOfDayIn(s.ends_at, edition.time_zone) || 1440,
    }));
  const roomIds = rooms
    .filter((r) => r.is_active || daySessions.some((s) => s.room_id === r.id))
    .map((r) => r.id);
  const grid = buildDayGrid(daySessions, roomIds);

  const selectedSession = daySessions.find((s) => s.id === selectedSessionId) ?? null;
  const selectedSlots = selectedSession
    ? dayRows.filter((r) => r.session_id === selectedSession.id)
    : [];

  const base = `/projects/${id}/interviews/schedule`;

  return (
    <div className="space-y-4">
      {/* ---- day picker ---- */}
      <div className="flex flex-wrap items-center gap-2">
        {days.map((d) => (
          <Link
            key={d}
            href={`${base}?day=${d}`}
            className={cx(
              'rounded-lg border px-3 py-1.5 text-sm',
              d === selectedDay
                ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                : 'border-line text-ink-muted hover:bg-surface-muted',
            )}
          >
            {formatDate(`${d}T12:00:00Z`, locale)}
          </Link>
        ))}
        {days.length === 0 ? <span className="text-sm text-ink-muted">{t('schedule.noDays')}</span> : null}
      </div>

      {/* ---- the grid ---- */}
      {grid.rows === 0 ? (
        <EmptyState>{t('schedule.emptyDay')}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <div style={{ minWidth: `calc(3.5rem + ${grid.columns.length} * 9rem)` }}>
            <div
              className="grid border-b border-line bg-surface-muted"
              style={{ gridTemplateColumns: `3.5rem repeat(${grid.columns.length}, minmax(9rem, 1fr))` }}
            >
              <div className="px-2 py-2 text-center text-xs font-medium text-ink-muted">{t('schedule.time')}</div>
              {grid.columns.map((column) => (
                <div key={column.room_id} className="border-s border-line px-2 py-2 text-center text-sm font-semibold">
                  {roomName.get(column.room_id) ?? ''}
                </div>
              ))}
            </div>

            <div
              className="grid"
              style={{
                gridTemplateColumns: `3.5rem repeat(${grid.columns.length}, minmax(9rem, 1fr))`,
                gridTemplateRows: `repeat(${grid.rows}, 0.55rem)`,
              }}
            >
              {grid.labels.map((label) => (
                <div
                  key={label.row}
                  style={{ gridColumn: 1, gridRow: `${label.row} / span ${label.span}` }}
                  className="ltr-nums border-b border-line px-1 pt-0.5 text-[0.65rem] text-ink-muted"
                >
                  {label.label}
                </div>
              ))}

              {grid.columns.flatMap((column, columnIndex) =>
                column.blocks.map((block) => {
                  const s = block.session;
                  const counts = perSession.get(s.id) ?? { total: 0, booked: 0 };
                  const selected = s.id === selectedSessionId;
                  return (
                    <Link
                      key={s.id}
                      href={`${base}?day=${selectedDay}&session=${s.id}`}
                      style={{ gridColumn: columnIndex + 2, gridRow: `${block.row} / span ${block.span}` }}
                      className={cx(
                        'm-0.5 flex flex-col overflow-hidden rounded-md border px-1.5 py-1 text-xs leading-tight',
                        selected
                          ? 'border-brand-600 bg-brand-100 text-brand-800'
                          : 'border-brand-200 bg-brand-50 text-brand-700 hover:border-brand-400',
                      )}
                    >
                      <span className="truncate font-semibold">{companyName.get(s.company_id) ?? '?'}</span>
                      <span className="ltr-nums opacity-80">
                        {formatTime(s.starts_at, locale)}–{formatTime(s.ends_at, locale)} · {s.slot_minutes}′
                      </span>
                      <span className="ltr-nums opacity-80">
                        {counts.booked}/{counts.total}
                      </span>
                    </Link>
                  );
                }),
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ---- the selected session ---- */}
        <Card className="lg:col-span-2">
          {selectedSession ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{companyName.get(selectedSession.company_id)}</h2>
                  <p className="ltr-nums text-xs text-ink-muted">
                    {roomName.get(selectedSession.room_id)} · {formatDate(`${selectedSession.day}T12:00:00Z`, locale)} ·{' '}
                    {formatTime(selectedSession.starts_at, locale)}–{formatTime(selectedSession.ends_at, locale)} ·{' '}
                    {t('schedule.slotLength', { minutes: selectedSession.slot_minutes })}
                  </p>
                </div>
                {manage ? (
                  <ConfirmForm
                    action={deleteSessionAction}
                    trigger={t('schedule.deleteSession')}
                    title={t('schedule.deleteSessionTitle')}
                    body={t('schedule.deleteSessionBody')}
                    confirmLabel={tCommon('delete')}
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="project_id" value={id} />
                    <input type="hidden" name="session_id" value={selectedSession.id} />
                  </ConfirmForm>
                ) : null}
              </div>

              <ul className="divide-y divide-line text-sm">
                {selectedSlots.map((slot) => (
                  <li key={slot.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="ltr-nums w-24 font-medium">
                      {formatTime(slot.starts_at, locale)}–{formatTime(slot.ends_at, locale)}
                    </span>
                    {slot.booking_id ? (
                      <>
                        <span className="min-w-0 flex-1 truncate">{slot.student_name}</span>
                        <Badge tone={STAGE_TONES[slot.stage ?? 'scheduled']}>{t(`stage.${slot.stage ?? 'scheduled'}`)}</Badge>
                      </>
                    ) : slot.is_closed ? (
                      <>
                        <span className="min-w-0 flex-1 text-ink-muted">{t('schedule.closed')}</span>
                        {manage ? (
                          <ActionForm action={setSlotClosedAction} submitLabel={t('schedule.reopen')} variant="secondary" className="space-y-0">
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="project_id" value={id} />
                            <input type="hidden" name="slot_id" value={slot.id} />
                            <input type="hidden" name="closed" value="false" />
                          </ActionForm>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 text-ink-muted">{t('schedule.free')}</span>
                        {manage ? (
                          <ActionForm action={setSlotClosedAction} submitLabel={t('schedule.close')} variant="secondary" className="space-y-0">
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="project_id" value={id} />
                            <input type="hidden" name="slot_id" value={slot.id} />
                            <input type="hidden" name="closed" value="true" />
                          </ActionForm>
                        ) : null}
                      </>
                    )}
                  </li>
                ))}
              </ul>

              {manage ? (
                <div className="mt-4 border-t border-line pt-3">
                  <ActionForm action={extendSessionAction} submitLabel={t('schedule.extend')} variant="secondary">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="project_id" value={id} />
                    <input type="hidden" name="session_id" value={selectedSession.id} />
                    <div className="max-w-xs">
                      <Label htmlFor="extend_end">{t('schedule.extendTo')}</Label>
                      <Input id="extend_end" name="end_time" type="time" dir="ltr" step={300} required />
                    </div>
                  </ActionForm>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-ink-muted">{t('schedule.pickSession')}</p>
          )}
        </Card>

        <div className="space-y-4">
          {/* ---- new session (the generator) ---- */}
          {manage ? (
            <Card>
              <h2 className="mb-1 font-semibold">{t('schedule.newSession')}</h2>
              <p className="mb-3 text-xs text-ink-muted">{t('schedule.newSessionHint')}</p>
              {companies.length && rooms.some((r) => r.is_active) ? (
                <ActionForm action={createSessionAction} submitLabel={tCommon('create')}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="project_id" value={id} />
                  <div>
                    <Label htmlFor="s_company">{t('company')}</Label>
                    <Select id="s_company" name="company_id" required>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {localized(c, 'name', locale)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="s_room">{t('schedule.room')}</Label>
                    <Select id="s_room" name="room_id" required>
                      {rooms
                        .filter((r) => r.is_active)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="s_day">{t('schedule.day')}</Label>
                    <Input id="s_day" name="day" type="date" dir="ltr" defaultValue={selectedDay} required />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label htmlFor="s_start">{t('schedule.from')}</Label>
                      <Input id="s_start" name="start_time" type="time" dir="ltr" step={300} defaultValue="14:00" required />
                    </div>
                    <div>
                      <Label htmlFor="s_end">{t('schedule.to')}</Label>
                      <Input id="s_end" name="end_time" type="time" dir="ltr" step={300} defaultValue="17:00" required />
                    </div>
                    <div>
                      <Label htmlFor="s_len">{t('schedule.slotMinutes')}</Label>
                      <Select id="s_len" name="slot_minutes" defaultValue="20" required>
                        {SLOT_LENGTHS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </ActionForm>
              ) : (
                <p className="text-sm text-ink-muted">{t('schedule.needSetup')}</p>
              )}
            </Card>
          ) : null}

          {/* ---- rooms ---- */}
          <Card>
            <h2 className="mb-3 font-semibold">{t('schedule.rooms')}</h2>
            {rooms.length ? (
              <ul className="mb-3 divide-y divide-line text-sm">
                {rooms.map((room) => (
                  <li key={room.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className={cx('font-medium', !room.is_active && 'text-ink-muted line-through')}>{room.name}</span>
                    {room.note ? <span className="text-xs text-ink-muted">{room.note}</span> : null}
                    {manage ? (
                      <div className="ms-auto flex gap-2">
                        <ActionForm action={upsertRoomAction} submitLabel={room.is_active ? t('schedule.retire') : t('schedule.bringBack')} variant="secondary" className="space-y-0">
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="project_id" value={id} />
                          <input type="hidden" name="room_id" value={room.id} />
                          <input type="hidden" name="is_active" value={room.is_active ? 'false' : 'true'} />
                        </ActionForm>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-ink-muted">{t('schedule.noRooms')}</p>
            )}
            {manage ? (
              <Disclosure label={t('schedule.newRoom')}>
                <ActionForm action={upsertRoomAction} submitLabel={tCommon('create')}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="project_id" value={id} />
                  <div>
                    <Label htmlFor="r_name">{t('schedule.roomName')}</Label>
                    <Input id="r_name" name="name" required />
                  </div>
                  <div>
                    <Label htmlFor="r_note">{t('schedule.roomNote')}</Label>
                    <Input id="r_note" name="note" />
                  </div>
                </ActionForm>
              </Disclosure>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
