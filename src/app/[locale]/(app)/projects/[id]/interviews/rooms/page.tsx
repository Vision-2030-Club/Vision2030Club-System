import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { Card, EmptyState, Input, Label, Select } from '@/components/ui';
import { formatDate, formatTime, localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { companySheets, sheetKey } from '@/lib/interviews/companySheets';
import { siteUrl } from '@/lib/interviews/email';
import { floorLayout, roomDays, type RoomDays } from '@/lib/interviews/floorLayout';
import { sessionLinks } from '@/lib/interviews/roomLinks';
import { loadCompanies, loadRooms, loadSessionAcceptances, loadSessions } from '@/lib/interviews/queries';
import { pages } from '@/lib/interviews/sheetFormat';
import { PRAYER_BREAKS, SLOT_MINUTES } from '@/lib/interviews/slotRules';
import type { Room, Session } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';
import { CopyField } from '../CopyField';
import {
  createSessionAction,
  createSessionLinkAction,
  deleteSessionAction,
  syncCompanySheetAction,
  upsertRoomAction,
} from '../actions';
import { AcceptedPhones } from './AcceptedPhones';

/**
 * The venue: one card per room, made on its own, with no company needed.
 * A room has a name and a location (`rooms.note`: building, floor…), and
 * companies are ASSIGNED to it afterwards, each for a day and hours: a
 * session (create_session), which is what makes its time slots. One room
 * can host several companies on one day at different hours, and a company
 * can be assigned to several rooms. Companies themselves are made on the
 * Companies tab, with nothing about rooms.
 *
 * A room can be given its own days (`room_days` in the edition's settings,
 * floorLayout.ts): the floor and its Google Sheet lay it out on those days
 * only, and companies are assigned to it on those days only. Without them
 * it is on every event day of Settings → Event days and hours.
 *
 * Each assignment carries what belongs to that company on that day: its
 * candidate link (roomLinks.ts), its accepted phone list (0014: a student on
 * it books only this assignment's times, so HR decides their day by the list
 * they are put on), and the company's Google Sheet for this room.
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
  const { edition, settings, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  if (role === 'organizer') return <EmptyState>{tCommon('notPermitted')}</EmptyState>;
  const manage = can.manage(role);
  const decide = can.decide(role);

  const db = createInterviewsClient();
  type SlotRow = { session_id: string; booking_id: string | null; is_closed: boolean };
  const [rooms, companies, sessions, acceptances, slotRows] = await Promise.all([
    loadRooms(db, edition.id),
    loadCompanies(db, edition.id),
    loadSessions(db, edition.id),
    loadSessionAcceptances(db, edition.id),
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
  const daysOf = roomDays(settings);
  const links = sessionLinks(settings);
  const sheets = companySheets(settings);
  // A new assignment starts on the room's first day, else the event's first
  // day, else the edition's latest day with one, else today.
  const fallbackDay =
    floorLayout(settings)?.from_day ?? (sessions.length ? sessions[sessions.length - 1].day : toDateInput(new Date()));

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
            const own = daysOf[room.id];
            return (
              <Card key={room.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-semibold">{room.name}</h2>
                    <p className="text-sm text-ink-muted">{room.note ?? t('roomsTab.noLocation')}</p>
                    <p className="ltr-nums text-sm text-ink-muted">
                      {own ? daysLabel(own, locale) : t('roomsTab.everyEventDay')}
                    </p>
                  </div>
                  {manage ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Disclosure label={tCommon('edit')} title={room.name}>
                        <RoomFields locale={locale} projectId={id} room={room} days={own} t={t} submitLabel={tCommon('save')} />
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
                    <ul className="space-y-2 text-sm">
                      {assigned.map((s) => {
                        const c = counts.get(s.id) ?? { booked: 0, total: 0 };
                        const link = links[s.id];
                        const sheet = sheets[sheetKey(s.company_id, room.id)];
                        return (
                          <li key={s.id} className="space-y-2 rounded-lg border border-line px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
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
                            </div>

                            {decide ? (
                              <div className="space-y-2">
                                {link ? (
                                  <CopyField label={t('companies.candidateLink')} value={`${siteUrl()}/${locale}/interviews/room/${link}`} />
                                ) : null}
                                {manage ? (
                                  <ActionForm
                                    action={createSessionLinkAction}
                                    submitLabel={link ? t('roomsTab.newLink') : t('roomsTab.createLink')}
                                    variant="secondary"
                                    className="space-y-0"
                                  >
                                    <input type="hidden" name="locale" value={locale} />
                                    <input type="hidden" name="project_id" value={id} />
                                    <input type="hidden" name="session_id" value={s.id} />
                                  </ActionForm>
                                ) : null}
                                <Disclosure
                                  label={`${t('companies.acceptedPhones')} (${acceptances.bySession.get(s.id)?.length ?? 0})`}
                                  title={`${t('companies.acceptedPhones')} · ${companyName.get(s.company_id) ?? ''}`}
                                >
                                  {acceptances.ready ? (
                                    <AcceptedPhones
                                      locale={locale}
                                      projectId={id}
                                      sessionId={s.id}
                                      phones={acceptances.bySession.get(s.id) ?? []}
                                    />
                                  ) : (
                                    <p className="text-sm text-ink-muted">{t('roomsTab.needs0014')}</p>
                                  )}
                                </Disclosure>
                                {manage ? (
                                  <Disclosure label={t('roomsTab.sheet')} title={`${t('roomsTab.sheet')} · ${companyName.get(s.company_id) ?? ''}`}>
                                    <div className="space-y-3">
                                      <p className="text-xs text-ink-muted">{t('companies.sheetHint')}</p>
                                      {sheet ? (
                                        <a
                                          href={sheet.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-sm font-medium text-brand-600 hover:underline"
                                        >
                                          {t('companies.sheetOpen')}
                                        </a>
                                      ) : (
                                        <p className="text-sm text-ink-muted">{t('companies.sheetNone')}</p>
                                      )}
                                      <ActionForm
                                        action={syncCompanySheetAction}
                                        submitLabel={sheet ? t('companies.sheetSync') : t('companies.sheetCreate')}
                                        variant="secondary"
                                        className="space-y-2"
                                      >
                                        <input type="hidden" name="locale" value={locale} />
                                        <input type="hidden" name="project_id" value={id} />
                                        <input type="hidden" name="company_id" value={s.company_id} />
                                      </ActionForm>
                                    </div>
                                  </Disclosure>
                                ) : null}
                              </div>
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
                              <Input
                                id={`${room.id}-day`}
                                name="day"
                                type="date"
                                dir="ltr"
                                defaultValue={own?.from_day ?? fallbackDay}
                                min={own?.from_day}
                                max={own?.to_day}
                                required
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label htmlFor={`${room.id}-from`}>{t('schedule.from')}</Label>
                                <Input id={`${room.id}-from`} name="start_time" type="time" dir="ltr" step={300} defaultValue="14:00" required />
                              </div>
                              <div>
                                <Label htmlFor={`${room.id}-to`}>{t('schedule.to')}</Label>
                                <Input id={`${room.id}-to`} name="end_time" type="time" dir="ltr" step={300} defaultValue="17:00" required />
                              </div>
                            </div>
                            <p className="text-xs text-ink-muted">
                              {t('schedule.fixedSlots', { minutes: SLOT_MINUTES })}{' '}
                              {PRAYER_BREAKS.map(([from, to]) => (
                                <span key={from} dir="ltr" className="ltr-nums me-2 inline-block">
                                  {from}–{to}
                                </span>
                              ))}
                            </p>
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

/** "12 Oct 2026", or "12 Oct 2026 – 13 Oct 2026" for more than one day. */
function daysLabel(days: RoomDays, locale: string): string {
  const from = formatDate(`${days.from_day}T12:00:00Z`, locale);
  return days.to_day === days.from_day ? from : `${from} – ${formatDate(`${days.to_day}T12:00:00Z`, locale)}`;
}

/** Add a room (no `room`) or edit one: its name, where it is, and the days it is in use. */
function RoomFields({
  locale,
  projectId,
  room,
  days,
  t,
  submitLabel,
}: {
  locale: string;
  projectId: string;
  room?: Room;
  days?: RoomDays;
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
        <div>
          <Label htmlFor={`${key}-room-from`}>{t('roomsTab.fromDay')}</Label>
          <Input id={`${key}-room-from`} name="from_day" type="date" dir="ltr" defaultValue={days?.from_day ?? ''} />
        </div>
        <div>
          <Label htmlFor={`${key}-room-to`}>{t('roomsTab.toDay')}</Label>
          <Input id={`${key}-room-to`} name="to_day" type="date" dir="ltr" defaultValue={days?.to_day ?? ''} />
        </div>
      </div>
      <p className="text-xs text-ink-muted">{t('roomsTab.daysHint')}</p>
    </ActionForm>
  );
}
