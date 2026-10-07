import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { Card, EmptyState, Input, Label, Select } from '@/components/ui';
import { formatDate, formatTime, localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { loadCompanies, loadRooms, loadSessions } from '@/lib/interviews/queries';
import { pages } from '@/lib/interviews/sheetFormat';
import type { Room, Session } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';
import { createSessionAction, deleteSessionAction, upsertRoomAction } from '../actions';

const SLOT_LENGTHS = [5, 10, 15, 20, 25, 30, 40, 45, 60];

/**
 * The venue: one card per room, made on its own, with no company needed.
 * A room has a name and a location (`rooms.note`: building, floor…), and
 * companies are ASSIGNED to it afterwards, each for a day and hours: a
 * session (create_session), which is what makes its time slots. One room
 * can host several companies on one day at different hours, and a company
 * can be assigned to several rooms. Companies themselves are made on the
 * Companies tab, with nothing about rooms.
 *
 * A room is never deleted, only retired (`is_active`): its history stays,
 * and it can be brought back. An assignment with students booked in it
 * cannot be removed until they are moved or cancelled (delete_session).
 */
export default async function InterviewsRoomsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  if (role === 'organizer') return <EmptyState>{tCommon('notPermitted')}</EmptyState>;
  const manage = can.manage(role);

  const db = createInterviewsClient();
  type SlotRow = { session_id: string; booking_id: string | null; is_closed: boolean };
  const [rooms, companies, sessions, slotRows] = await Promise.all([
    loadRooms(db, edition.id),
    loadCompanies(db, edition.id),
    loadSessions(db, edition.id),
    pages<SlotRow>((from, to) =>
      db.from('slot_status').select('session_id, booking_id, is_closed').eq('edition_id', edition.id).order('id').range(from, to),
    ),
  ]);

  const counts = new Map<string, { booked: number; total: number }>();
  for (const row of slotRows) {
    const c = counts.get(row.session_id) ?? { booked: 0, total: 0 };
    if (row.booking_id) c.booked += 1;
    if (row.booking_id || !row.is_closed) c.total += 1;
    counts.set(row.session_id, c);
  }

  const companyName = new Map(companies.map((c) => [c.id, localized(c, 'name', locale)]));
  const assignable = companies.filter((c) => !c.is_hidden);
  const sessionsOf = (room: Room): Session[] =>
    sessions.filter((s) => s.room_id === room.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const active = rooms.filter((r) => r.is_active);
  const retired = rooms.filter((r) => !r.is_active);
  // A new assignment starts on the edition's latest day with one, else today.
  const defaultDay = sessions.length ? sessions[sessions.length - 1].day : toDateInput(new Date());

  return (
    <div className="space-y-4">
      {manage ? (
        <Disclosure label={t('roomsTab.add')}>
          <RoomFields locale={locale} projectId={id} t={t} submitLabel={tCommon('create')} />
        </Disclosure>
      ) : null}

      {active.length === 0 ? (
        <EmptyState>{t('roomsTab.empty')}</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {active.map((room) => {
            const assigned = sessionsOf(room);
            return (
              <Card key={room.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-semibold">{room.name}</h2>
                    <p className="text-sm text-ink-muted">{room.note ?? t('roomsTab.noLocation')}</p>
                  </div>
                  {manage ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Disclosure label={tCommon('edit')} title={room.name}>
                        <RoomFields locale={locale} projectId={id} room={room} t={t} submitLabel={tCommon('save')} />
                      </Disclosure>
                      <ActionForm action={upsertRoomAction} submitLabel={t('roomsTab.retire')} variant="secondary" className="space-y-0">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="project_id" value={id} />
                        <input type="hidden" name="room_id" value={room.id} />
                        <input type="hidden" name="is_active" value="false" />
                      </ActionForm>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 border-t border-line pt-3">
                  <h3 className="mb-2 text-sm font-semibold">{t('roomsTab.assignments')}</h3>
                  {assigned.length === 0 ? (
                    <p className="text-sm text-ink-muted">{t('roomsTab.noAssignments')}</p>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {assigned.map((s) => {
                        const c = counts.get(s.id) ?? { booked: 0, total: 0 };
                        return (
                          <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-1.5">
                            <span className="font-medium">{companyName.get(s.company_id) ?? '?'}</span>
                            <Link
                              href={`/projects/${id}/interviews/schedule?day=${s.day}&session=${s.id}`}
                              className="ltr-nums text-xs text-ink-muted hover:underline"
                            >
                              {formatDate(`${s.day}T12:00:00Z`, locale)} · {formatTime(s.starts_at, locale)}–
                              {formatTime(s.ends_at, locale)} · {t('schedule.slotLength', { minutes: s.slot_minutes })}
                            </Link>
                            <span className="ltr-nums ms-auto text-xs text-ink-muted">
                              {t('roomsTab.booked', { booked: c.booked, total: c.total })}
                            </span>
                            {manage ? (
                              <ConfirmForm
                                action={deleteSessionAction}
                                trigger={t('roomsTab.unassign')}
                                title={t('roomsTab.unassignTitle')}
                                body={t('roomsTab.unassignBody')}
                                confirmLabel={t('roomsTab.unassign')}
                                variant="secondary"
                              >
                                <input type="hidden" name="locale" value={locale} />
                                <input type="hidden" name="project_id" value={id} />
                                <input type="hidden" name="session_id" value={s.id} />
                              </ConfirmForm>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {manage ? (
                    <div className="mt-3">
                      {assignable.length === 0 ? (
                        <p className="text-sm text-ink-muted">
                          {t('roomsTab.needCompany')}{' '}
                          <Link href={`/projects/${id}/interviews/companies`} className="text-brand-600 hover:underline">
                            {t('tabs.companies')}
                          </Link>
                        </p>
                      ) : (
                        <Disclosure label={t('roomsTab.assign')} title={`${t('roomsTab.assign')} · ${room.name}`}>
                          <ActionForm action={createSessionAction} submitLabel={t('roomsTab.assign')}>
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="project_id" value={id} />
                            <input type="hidden" name="room_id" value={room.id} />
                            <p className="text-xs text-ink-muted">{t('roomsTab.assignHint')}</p>
                            <div>
                              <Label htmlFor={`${room.id}-company`}>{t('company')}</Label>
                              <Select id={`${room.id}-company`} name="company_id" required>
                                {assignable.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {localized(c, 'name', locale)}
                                  </option>
                                ))}
                              </Select>
                            </div>
                            <div>
                              <Label htmlFor={`${room.id}-day`}>{t('schedule.day')}</Label>
                              <Input id={`${room.id}-day`} name="day" type="date" dir="ltr" defaultValue={defaultDay} required />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <Label htmlFor={`${room.id}-from`}>{t('schedule.from')}</Label>
                                <Input id={`${room.id}-from`} name="start_time" type="time" dir="ltr" step={300} defaultValue="14:00" required />
                              </div>
                              <div>
                                <Label htmlFor={`${room.id}-to`}>{t('schedule.to')}</Label>
                                <Input id={`${room.id}-to`} name="end_time" type="time" dir="ltr" step={300} defaultValue="17:00" required />
                              </div>
                              <div>
                                <Label htmlFor={`${room.id}-len`}>{t('schedule.slotMinutes')}</Label>
                                <Select id={`${room.id}-len`} name="slot_minutes" defaultValue="20" required>
                                  {SLOT_LENGTHS.map((n) => (
                                    <option key={n} value={n}>
                                      {n}
                                    </option>
                                  ))}
                                </Select>
                              </div>
                            </div>
                          </ActionForm>
                        </Disclosure>
                      )}
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {manage && retired.length > 0 ? (
        <Disclosure label={t('roomsTab.retiredSection', { count: retired.length })}>
          <ul className="space-y-2">
            {retired.map((room) => (
              <li key={room.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="text-sm text-ink-muted">
                  {room.name}
                  {room.note ? ` · ${room.note}` : ''}
                </span>
                <ActionForm action={upsertRoomAction} submitLabel={t('roomsTab.bringBack')} variant="secondary" className="space-y-0">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="project_id" value={id} />
                  <input type="hidden" name="room_id" value={room.id} />
                  <input type="hidden" name="is_active" value="true" />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'interviews'>>>;

/** Add a room (no `room`) or edit one: its name and where it is. */
function RoomFields({
  locale,
  projectId,
  room,
  t,
  submitLabel,
}: {
  locale: string;
  projectId: string;
  room?: Room;
  t: T;
  submitLabel: string;
}) {
  const key = room?.id ?? 'new';
  return (
    <ActionForm action={upsertRoomAction} submitLabel={submitLabel}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="project_id" value={projectId} />
      {room ? <input type="hidden" name="room_id" value={room.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${key}-room-name`}>{t('roomsTab.name')}</Label>
          <Input id={`${key}-room-name`} name="name" defaultValue={room?.name} required />
        </div>
        <div>
          <Label htmlFor={`${key}-room-location`}>{t('roomsTab.location')}</Label>
          <Input id={`${key}-room-location`} name="note" defaultValue={room?.note ?? ''} placeholder={t('roomsTab.locationHint')} />
        </div>
      </div>
    </ActionForm>
  );
}
