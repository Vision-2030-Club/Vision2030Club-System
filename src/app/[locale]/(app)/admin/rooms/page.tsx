import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import {
  Badge,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui';
import { formatDate, formatTime, localized, toDateInput } from '@/lib/format';
import {
  blockRoomTimeAction,
  createRoomAction,
  deleteBookingAction,
  renameRoomAction,
  setRoomActiveAction,
  updateBookingSettingsAction,
} from './actions';

type Room = { id: string; name_en: string; name_ar: string; is_active: boolean };

type Booking = {
  id: string;
  room_id: string;
  starts_at: string;
  ends_at: string;
  status: 'held' | 'booked' | 'blocked';
  party_kind: 'team' | 'project' | 'presidency' | 'block';
  title: string;
  teams: { name_en: string; name_ar: string } | null;
  projects: { name_en: string; name_ar: string } | null;
  members: { name_en: string; name_ar: string } | null;
};

const STATUS_TONES = {
  booked: 'ok',
  held: 'warn',
  blocked: 'danger',
} as const;

/** "12:00", "12:30", … across the club's operating hours. */
function halfHourOptions(opensMinute: number, closesMinute: number): string[] {
  const options: string[] = [];
  for (let minute = opensMinute; minute <= closesMinute; minute += 30) {
    // 1440 is midnight at the END of the day; an <input> wants "24:00" spelled
    // as "00:00", but our own selects read better showing 24:00.
    const hours = Math.floor(minute / 60);
    const minutes = minute % 60;
    options.push(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
  }
  return options;
}

export default async function AdminRoomsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { locale } = await params;
  const { day } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('rooms');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();

  /*
   * `rooms_write` already refuses everything on this page to anyone without
   * rooms.manage, so this check adds no security — it just gives a readable
   * page instead of a screen of forms that all fail.
   */
  const canManage = await hasPermission('rooms.manage');
  if (!canManage) {
    return (
      <>
        <PageHeader title={t('adminTitle')} description={t('adminSubtitle')} />
        <EmptyState>{tCommon('notPermitted')}</EmptyState>
      </>
    );
  }

  const today = toDateInput(new Date());
  const selectedDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today;

  const [{ data: rooms }, { data: settings }, { data: bookings }] = await Promise.all([
    supabase.from('rooms').select('id, name_en, name_ar, is_active').order('name_en'),
    supabase.from('booking_settings').select('*').eq('id', true).maybeSingle(),
    supabase
      .from('room_bookings')
      .select(
        'id, room_id, starts_at, ends_at, status, party_kind, title, teams(name_en, name_ar), projects(name_en, name_ar), members:booked_by(name_en, name_ar)',
      )
      .gte('starts_at', `${selectedDay}T00:00:00`)
      .lt('starts_at', `${selectedDay}T23:59:59`)
      .order('starts_at'),
  ]);

  const allRooms = (rooms ?? []) as Room[];
  const activeRooms = allRooms.filter((room) => room.is_active);
  const dayBookings = (bookings ?? []) as unknown as Booking[];

  const opensMinute = (settings?.opens_minute as number) ?? 720;
  const closesMinute = (settings?.closes_minute as number) ?? 1440;
  const times = halfHourOptions(opensMinute, closesMinute);

  const label = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

  const partyName = (booking: Booking) => {
    if (booking.party_kind === 'block') return t('itBlock');
    if (booking.party_kind === 'presidency') return t('presidency');
    if (booking.party_kind === 'team') return localized(booking.teams, 'name', locale);
    return localized(booking.projects, 'name', locale);
  };

  return (
    <>
      <PageHeader title={t('adminTitle')} description={t('adminSubtitle')} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- Rooms ---- */}
        <Card>
          <h2 className="mb-3 font-semibold">{t('rooms')}</h2>

          <div className="mb-4">
            <Disclosure label={t('newRoom')}>
              <ActionForm action={createRoomAction} submitLabel={tCommon('create')}>
                <input type="hidden" name="locale" value={locale} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="name_en">{t('roomName')} (EN)</Label>
                    <Input id="name_en" name="name_en" required />
                  </div>
                  <div>
                    <Label htmlFor="name_ar">{t('roomName')} (AR)</Label>
                    <Input id="name_ar" name="name_ar" required />
                  </div>
                </div>
              </ActionForm>
            </Disclosure>
          </div>

          {allRooms.length ? (
            <ul className="divide-y divide-line">
              {allRooms.map((room) => (
                <li key={room.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">
                      {localized(room, 'name', locale)}
                    </span>
                    {room.is_active ? null : <Badge>{t('retired')}</Badge>}

                    <div className="ms-auto">
                      <ActionForm
                        action={setRoomActiveAction}
                        submitLabel={room.is_active ? t('retire') : t('bringBack')}
                        variant="secondary"
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="room_id" value={room.id} />
                        <input
                          type="hidden"
                          name="is_active"
                          value={room.is_active ? 'false' : 'true'}
                        />
                      </ActionForm>
                    </div>
                  </div>

                  <div className="mt-2">
                    <Disclosure label={tCommon('edit')} title={t('roomName')}>
                      <ActionForm action={renameRoomAction} submitLabel={tCommon('save')}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="room_id" value={room.id} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <Label htmlFor={`en-${room.id}`}>{t('roomName')} (EN)</Label>
                            <Input id={`en-${room.id}`} name="name_en" defaultValue={room.name_en} required />
                          </div>
                          <div>
                            <Label htmlFor={`ar-${room.id}`}>{t('roomName')} (AR)</Label>
                            <Input id={`ar-${room.id}`} name="name_ar" defaultValue={room.name_ar} required />
                          </div>
                        </div>
                      </ActionForm>
                    </Disclosure>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{t('noRooms')}</EmptyState>
          )}
        </Card>

        {/* ---- The one global window ---- */}
        <Card>
          <h2 className="mb-1 font-semibold">{t('settings')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('settingsHint')}</p>

          <ActionForm action={updateBookingSettingsAction} submitLabel={tCommon('save')}>
            <input type="hidden" name="locale" value={locale} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="opens_at">{t('opensAt')}</Label>
                <Input
                  id="opens_at"
                  name="opens_at"
                  dir="ltr"
                  pattern="[0-9]{1,2}:[0-9]{2}"
                  defaultValue={label(opensMinute)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="closes_at">{t('closesAt')}</Label>
                <Input
                  id="closes_at"
                  name="closes_at"
                  dir="ltr"
                  pattern="[0-9]{1,2}:[0-9]{2}"
                  defaultValue={label(closesMinute)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="days_ahead">{t('daysAhead')}</Label>
                <Input
                  id="days_ahead"
                  name="days_ahead"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={(settings?.days_ahead as number) ?? 14}
                  required
                />
              </div>
            </div>
          </ActionForm>
        </Card>

        {/* ---- Block time off ---- */}
        <Card>
          <h2 className="mb-1 font-semibold">{t('blockTime')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('blockTimeHint')}</p>

          {activeRooms.length ? (
            <ActionForm action={blockRoomTimeAction} submitLabel={t('block')}>
              <input type="hidden" name="locale" value={locale} />
              <div>
                <Label htmlFor="block_room">{t('room')}</Label>
                <Select id="block_room" name="room_id" required>
                  {activeRooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {localized(room, 'name', locale)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="block_day">{t('day')}</Label>
                  <Input id="block_day" name="day" type="date" defaultValue={selectedDay} required />
                </div>
                <div>
                  <Label htmlFor="block_start">{t('from')}</Label>
                  <Select id="block_start" name="starts_at" defaultValue={times[0]} required>
                    {times.slice(0, -1).map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="block_end">{t('to')}</Label>
                  <Select id="block_end" name="ends_at" defaultValue={times[1]} required>
                    {times.slice(1).map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="reason">{t('reason')}</Label>
                <Textarea id="reason" name="reason" rows={2} required />
              </div>
            </ActionForm>
          ) : (
            <EmptyState>{t('noRooms')}</EmptyState>
          )}
        </Card>

        {/* ---- One day's bookings, with IT's delete power ---- */}
        <Card>
          <h2 className="mb-3 font-semibold">{t('dayBookings')}</h2>

          <form className="mb-3">
            <Label htmlFor="day">{t('day')}</Label>
            <Input id="day" name="day" type="date" defaultValue={selectedDay} className="max-w-xs" />
          </form>

          {dayBookings.length ? (
            <ul className="divide-y divide-line">
              {dayBookings.map((booking) => (
                <li key={booking.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="ltr-nums text-sm font-medium text-ink">
                        {formatTime(booking.starts_at, locale)} – {formatTime(booking.ends_at, locale)}
                      </span>
                      <Badge tone={STATUS_TONES[booking.status]}>{t(`status_${booking.status}`)}</Badge>
                    </div>
                    <div className="text-sm text-ink">{booking.title}</div>
                    {/* §4: everyone sees who booked it and for which group. */}
                    <div className="text-xs text-ink-muted">
                      {partyName(booking)} · {localized(booking.members, 'name', locale)}
                    </div>
                  </div>

                  <ConfirmForm
                    action={deleteBookingAction}
                    trigger={tCommon('delete')}
                    title={t('deleteBookingTitle')}
                    body={t('deleteBookingBody')}
                    confirmLabel={tCommon('delete')}
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="booking_id" value={booking.id} />
                  </ConfirmForm>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{t('noBookings', { day: formatDate(selectedDay, locale) })}</EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}
