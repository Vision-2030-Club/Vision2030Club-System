import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, hasPermission, scopeFor } from '@/lib/auth/session';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { formatDate, localized } from '@/lib/format';
import { CLUB_TIME_ZONE, addDaysToDateInput, toDateInput } from '@/lib/time';
import {
  IDENTITY_COOKIE,
  buildColumn,
  buildSlots,
  type BookingView,
  type Identity,
} from '@/lib/rooms';
import { RoomSchedule, type RoomColumn } from './RoomSchedule';

type BookingRow = {
  id: string;
  room_id: string;
  starts_at: string;
  ends_at: string;
  status: 'held' | 'booked' | 'blocked';
  party_kind: 'team' | 'project' | 'presidency' | 'block';
  title: string;
  teams: { name_en: string; name_ar: string } | null;
  projects: { name_en: string; name_ar: string } | null;
  other_teams: { name_en: string; name_ar: string } | null;
  other_projects: { name_en: string; name_ar: string } | null;
  other_members: { name_en: string; name_ar: string } | null;
  members: { id: string; name_en: string; name_ar: string } | null;
};

export default async function RoomsPage({
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
  const supabase = await createClient();
  const me = await getMyMember();

  /*
   * §4 and §6 share one population: whoever may book may see the schedule, and
   * a plain Member may do neither. RLS returns nothing to them anyway — this
   * only turns an empty grid into a sentence that explains itself.
   */
  const bookScope = await scopeFor('rooms.book');
  if (bookScope === 'none') {
    return (
      <>
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState>{t('notForMembers')}</EmptyState>
      </>
    );
  }

  const { data: settings } = await supabase
    .from('booking_settings')
    .select('opens_minute, closes_minute, days_ahead')
    .eq('id', true)
    .maybeSingle();

  const opensMinute = (settings?.opens_minute as number) ?? 720;
  const closesMinute = (settings?.closes_minute as number) ?? 1440;
  const daysAhead = (settings?.days_ahead as number) ?? 14;

  // The window is "today plus days_ahead", on the club's clock (0027).
  const today = toDateInput(new Date());
  const lastDay = addDaysToDateInput(today, daysAhead);
  const requested = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today;
  const selectedDay = requested < today ? today : requested > lastDay ? lastDay : requested;

  const [{ data: rooms }, { data: bookings }] = await Promise.all([
    supabase
      .from('rooms')
      .select('id, name_en, name_ar')
      .eq('is_active', true)
      .order('name_en'),
    supabase
      .from('room_bookings')
      .select(
        'id, room_id, starts_at, ends_at, status, party_kind, title,' +
          ' teams:team_id(name_en, name_ar), projects:project_id(name_en, name_ar),' +
          ' other_teams:other_team_id(name_en, name_ar), other_projects:other_project_id(name_en, name_ar),' +
          ' other_members:other_member_id(name_en, name_ar),' +
          ' members:booked_by(id, name_en, name_ar)',
      )
      // A day is a day on the club's clock, so the bounds carry the zone name
      // for the same reason writes do.
      .gte('starts_at', `${selectedDay} 00:00:00 ${CLUB_TIME_ZONE}`)
      .lt('starts_at', `${addDaysToDateInput(selectedDay, 1)} 00:00:00 ${CLUB_TIME_ZONE}`)
      .order('starts_at'),
  ]);

  const roomRows = rooms ?? [];

  if (roomRows.length === 0) {
    return (
      <>
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState>{t('noRoomsYet')}</EmptyState>
      </>
    );
  }

  /*
   * Which groups this person may book as (§4: "only as a team they actually
   * direct, a project they actually manage, or Presidency if they're in it").
   *
   * These come from the same scope the database will check, so the picker
   * cannot offer something the insert policy would then refuse.
   */
  const identities: Identity[] = [];

  if (bookScope === 'all') {
    identities.push({
      value: 'presidency',
      label: t('presidency'),
      party_kind: 'presidency',
      team_id: null,
      project_id: null,
    });
  } else if (bookScope === 'own_team' && me) {
    identities.push({
      value: `team:${me.team_id}`,
      label: locale === 'ar' ? me.team_name_ar : me.team_name_en,
      party_kind: 'team',
      team_id: me.team_id,
      project_id: null,
    });
  } else if (bookScope === 'own_projects' && me) {
    const { data: managed } = await supabase
      .from('project_managers')
      .select('projects(id, name_en, name_ar)')
      .eq('member_id', me.id);

    for (const row of managed ?? []) {
      const project = row.projects as unknown as Record<string, string> | null;
      if (!project) continue;
      identities.push({
        value: `project:${project.id}`,
        label: localized(project, 'name', locale),
        party_kind: 'project',
        team_id: null,
        project_id: String(project.id),
      });
    }
  }

  const remembered = (await cookies()).get(IDENTITY_COOKIE)?.value;
  const defaultIdentity =
    identities.find((identity) => identity.value === remembered)?.value ??
    identities[0]?.value ??
    '';

  // Minutes from midnight on the club's clock, which is the unit the grid and
  // `booking_settings` both work in.
  const minuteOfDay = (iso: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: CLUB_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
    const [hours, minutes] = parts.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const partyLabel = (booking: BookingRow) => {
    const own =
      booking.party_kind === 'block'
        ? t('itBlock')
        : booking.party_kind === 'presidency'
          ? t('presidency')
          : booking.party_kind === 'team'
            ? localized(booking.teams, 'name', locale)
            : localized(booking.projects, 'name', locale);

    // A meeting's booking carries both sides, which is where "Design × Media"
    // comes from. A self-service booking never has one (§4).
    const other =
      localized(booking.other_teams, 'name', locale) ||
      localized(booking.other_projects, 'name', locale) ||
      localized(booking.other_members, 'name', locale);

    return other ? `${own} × ${other}` : own;
  };

  const slots = buildSlots(opensMinute, closesMinute);

  const columns: RoomColumn[] = roomRows.map((room) => {
    const forRoom: BookingView[] = ((bookings ?? []) as unknown as BookingRow[])
      .filter((booking) => booking.room_id === room.id)
      .map((booking) => {
        const endMinute = minuteOfDay(booking.ends_at);
        return {
          id: booking.id,
          room_id: booking.room_id,
          status: booking.status,
          party_kind: booking.party_kind,
          title: booking.title,
          partyLabel: partyLabel(booking),
          bookedByName: localized(booking.members, 'name', locale),
          bookedById: String(booking.members?.id ?? ''),
          startMinute: minuteOfDay(booking.starts_at),
          // A booking ending at midnight reads as minute 0 of the next day.
          endMinute: endMinute === 0 ? 1440 : endMinute,
        };
      });

    return {
      id: room.id,
      name: localized(room, 'name', locale),
      cells: buildColumn(slots, forRoom, closesMinute),
    };
  });

  const canRemoveAny = await hasPermission('rooms.manage');
  const previousDay = addDaysToDateInput(selectedDay, -1);
  const nextDay = addDaysToDateInput(selectedDay, 1);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <Badge tone="neutral">
            {t('window', { days: daysAhead })}
          </Badge>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DayLink day={previousDay} disabled={previousDay < today} label={t('previousDay')} />
        <DayLink day={nextDay} disabled={nextDay > lastDay} label={t('nextDay')} />
        <Link
          href="/rooms"
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-muted"
        >
          {t('today')}
        </Link>
        <h2 className="ms-2 text-lg font-semibold text-ink">
          {formatDate(`${selectedDay}T12:00:00Z`, locale)}
        </h2>
      </div>

      {identities.length === 0 ? (
        <div className="mb-4">
          <EmptyState>{t('noIdentity')}</EmptyState>
        </div>
      ) : null}

      <RoomSchedule
        locale={locale}
        day={selectedDay}
        slots={slots}
        columns={columns}
        identities={identities}
        defaultIdentity={defaultIdentity}
        meId={me?.id ?? ''}
        canRemoveAny={canRemoveAny}
      />
    </>
  );
}

function DayLink({
  day,
  disabled,
  label,
}: {
  day: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="cursor-not-allowed rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted opacity-50">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={`/rooms?day=${day}`}
      className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-muted"
    >
      {label}
    </Link>
  );
}
