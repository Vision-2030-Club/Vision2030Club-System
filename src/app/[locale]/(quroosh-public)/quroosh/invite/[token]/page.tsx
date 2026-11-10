import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Card, PageHeader } from '@/components/ui';
import { isToken } from '@/lib/interviews/tokens';
import { groupSlotsByDay, slotLabel } from '@/lib/quroosh/guests';
import { COUNTRIES, DEFAULT_COUNTRY } from '@/lib/quroosh/phones';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { BookingForm, type CountryOption, type SlotDayOption } from './BookingForm';

/** A personal link: never in a search engine. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Invitation = {
  name: string;
  role: string;
  cancelled: boolean;
  slot_id: string | null;
  starts_at: string | null;
  booked_at: string | null;
};

/**
 * A guest's invitation (Quroosh 0005): /quroosh/invite/<token>, no account.
 * The token is the only key; the Quroosh database's `invitation()` answers
 * with this guest's name and booking, and `open_slots()` with the free
 * times. Neither returns anyone's phone or another guest.
 *
 *   unknown link  "this link is not valid"
 *   cancelled     says so
 *   booked        their session's day and time, no form: only a manager
 *                 changes a booking
 *   otherwise     the free times and the booking form
 *
 * Times are on the club's clock (slotLabel), whatever the guest's own time
 * zone.
 */
export default async function QurooshInvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh.invite');

  const db = isToken(token) && isQurooshConfigured() ? createQurooshClient() : null;
  let invitation: Invitation | undefined;
  if (db) {
    // Before 0005 is applied the function is missing: the link reads as unknown.
    const { data } = await db.rpc('invitation', { p_token: token });
    invitation = (data as Invitation[] | null)?.[0];
  }
  if (!db || !invitation) return <Alert tone="warn">{t('notFound')}</Alert>;

  const header = <PageHeader title={t('title')} description={t('greeting', { name: invitation.name })} />;

  if (invitation.cancelled) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="warn">{t('cancelled')}</Alert>
      </div>
    );
  }

  if (invitation.slot_id && invitation.starts_at) {
    const when = slotLabel(invitation.starts_at, locale);
    return (
      <div className="space-y-6">
        {header}
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">{t('booked.title')}</h2>
          <p className="text-ink">{when.day}</p>
          <p className="ltr-nums text-lg font-semibold text-ink" dir="ltr">
            {when.time}
          </p>
          <p className="text-sm text-ink-muted">{t('booked.change')}</p>
        </Card>
      </div>
    );
  }

  const { data: open } = await db.rpc('open_slots', { p_token: token });
  const days: SlotDayOption[] = groupSlotsByDay((open ?? []) as { id: string; starts_at: string }[]).map(
    ({ slots }) => ({
      day: slotLabel(slots[0].starts_at, locale).day,
      slots: slots.map((slot) => ({ id: slot.id, time: slotLabel(slot.starts_at, locale).time })),
    }),
  );

  const names = new Intl.DisplayNames([locale === 'ar' ? 'ar' : 'en'], { type: 'region' });
  const countries: CountryOption[] = COUNTRIES.map(([iso, dial]) => ({ iso, dial, name: names.of(iso) ?? iso })).sort(
    (a, b) =>
      a.iso === DEFAULT_COUNTRY ? -1 : b.iso === DEFAULT_COUNTRY ? 1 : a.name.localeCompare(b.name, locale),
  );

  return (
    <div className="space-y-6">
      {header}
      <p className="text-ink">{t('intro')}</p>
      {days.length === 0 ? (
        <Alert tone="warn">{t('noSlots')}</Alert>
      ) : (
        <BookingForm token={token} locale={locale} days={days} countries={countries} />
      )}
    </div>
  );
}
