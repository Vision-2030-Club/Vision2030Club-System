import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Badge, Card } from '@/components/ui';
import { formatDateTime, formatTime, localized } from '@/lib/format';
import {
  loadAllSlots,
  loadBookingsOf,
  loadCompanies,
  loadPreferences,
  loadRooms,
} from '@/lib/interviews/queries';
import { isToken } from '@/lib/interviews/tokens';
import type { Application, Edition, EditionSettings } from '@/lib/interviews/types';
import { STAGE_TONES } from '@/lib/interviews/ui';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { CancelForm, SlotPicker, type PickableSlot } from './SlotPicker';

/**
 * A student's own page. The link IS the login: whoever holds it sees only
 * the companies that accepted this student, the free slots each still has,
 * and the bookings made. Every button calls a function that resolves the
 * same token again, so nothing here is trusted by the database.
 */
export default async function StudentPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  if (!isToken(token) || !isInterviewsConfigured()) notFound();

  const t = await getTranslations('interviews');
  const db = createInterviewsClient();

  const { data: applicationRow } = await db
    .from('applications')
    .select('*')
    .eq('personal_token', token)
    .maybeSingle();
  const application = applicationRow as Application | null;
  if (!application) notFound();

  const [{ data: editionRow }, { data: settingsRow }, companies, rooms, preferences, bookings] =
    await Promise.all([
      db.from('editions').select('*').eq('id', application.edition_id).maybeSingle(),
      db.rpc('edition_settings', { p_edition: application.edition_id }),
      loadCompanies(db, application.edition_id),
      loadRooms(db, application.edition_id),
      loadPreferences(db, application.id),
      loadBookingsOf(db, application.id),
    ]);
  const edition = editionRow as Edition | null;
  const settings = settingsRow as EditionSettings | null;
  if (!edition) notFound();

  const now = new Date().getTime();
  const bookingOpen =
    edition.status === 'active' &&
    edition.booking_opens_at !== null &&
    edition.booking_closes_at !== null &&
    now >= new Date(edition.booking_opens_at).getTime() &&
    now < new Date(edition.booking_closes_at).getTime();
  const cutoffMs = (settings?.change_cutoff_hours ?? 12) * 3600e3;

  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const accepted = preferences
    .filter((p) => p.decision === 'accepted')
    .map((p) => companies.find((c) => c.id === p.company_id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const active = bookings.filter((b) => !b.cancelled_at);

  // Every slot of each accepted company — open, booked and past alike, so
  // the picker always shows the room's whole scheduled range instead of it
  // shrinking away from the start as the day goes on.
  const slotsByCompany = new Map<string, PickableSlot[]>();
  await Promise.all(
    accepted.map(async (company) => {
      const slots = await loadAllSlots(db, company.id);
      slotsByCompany.set(
        company.id,
        slots.map((s) => ({
          id: s.id,
          timeLabel: `${formatTime(s.starts_at, locale)} – ${formatTime(s.ends_at, locale)}`,
          taken: s.is_closed || s.booking_id !== null || new Date(s.starts_at).getTime() <= now,
        })),
      );
    }),
  );

  const { data: slotRooms } = active.length
    ? await db.from('slots').select('id, room_id').in('id', active.map((b) => b.slot_id))
    : { data: [] };
  const roomOfSlot = new Map((slotRooms ?? []).map((s) => [s.id as string, s.room_id as string]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{localized(edition, 'name', locale)}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('student.hello', { name: application.name })}</p>
        <p className="mt-1 text-xs text-ink-muted">{t('student.private')}</p>
      </div>

      {accepted.length === 0 ? (
        <Alert tone="info">{t('student.nothingYet')}</Alert>
      ) : !bookingOpen ? (
        <Alert tone="info">
          {edition.booking_opens_at && now < new Date(edition.booking_opens_at).getTime()
            ? t('student.bookingOpensAt', { when: formatDateTime(edition.booking_opens_at, locale) })
            : t('student.bookingClosed')}
        </Alert>
      ) : (
        <Alert tone="ok">{t('student.pickOne', { hours: settings?.change_cutoff_hours ?? 12 })}</Alert>
      )}

      {accepted.map((company) => {
        const booking = active.find((b) => b.company_id === company.id);
        const slots = slotsByCompany.get(company.id) ?? [];
        const hasFree = slots.some((s) => !s.taken);
        const canChange =
          bookingOpen &&
          booking?.stage === 'scheduled' &&
          new Date(booking.starts_at).getTime() - now >= cutoffMs;

        return (
          <Card key={company.id}>
            <div className="flex flex-wrap items-center gap-3">
              {company.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logo_url} alt="" width={40} height={40} className="size-10 rounded bg-white object-contain" />
              ) : null}
              <h2 className="font-semibold">{localized(company, 'name', locale)}</h2>
              {booking ? <Badge tone={STAGE_TONES[booking.stage]}>{t(`stage.${booking.stage}`)}</Badge> : null}
            </div>

            {booking ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm">
                  <span className="font-medium">{t('student.yourTime')}:</span>{' '}
                  <span className="ltr-nums">
                    {formatDateTime(booking.starts_at, locale)} – {formatTime(booking.ends_at, locale)}
                  </span>
                  {' · '}
                  {t('student.room', { room: roomName.get(roomOfSlot.get(booking.slot_id) ?? '') ?? '' })}
                </p>
                {canChange ? (
                  <div className="flex flex-wrap items-start gap-4">
                    {hasFree ? (
                      <SlotPicker
                        token={token}
                        locale={locale}
                        companyId={company.id}
                        bookingId={booking.id}
                        slots={slots}
                        mode="move"
                      />
                    ) : null}
                    <CancelForm token={token} locale={locale} bookingId={booking.id} />
                  </div>
                ) : bookingOpen && booking.stage === 'scheduled' ? (
                  <p className="text-xs text-ink-muted">{t('student.tooLate', { hours: settings?.change_cutoff_hours ?? 12 })}</p>
                ) : null}
              </div>
            ) : bookingOpen ? (
              hasFree ? (
                <div className="mt-3">
                  <SlotPicker token={token} locale={locale} companyId={company.id} slots={slots} mode="book" />
                </div>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">{t('student.noFreeSlots')}</p>
              )
            ) : null}
          </Card>
        );
      })}

      {bookings.some((b) => b.cancelled_at) ? (
        <p className="text-xs text-ink-muted">
          {t('student.cancelledNote', { count: bookings.filter((b) => b.cancelled_at).length })}
        </p>
      ) : null}
    </div>
  );
}
