import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Badge, Card } from '@/components/ui';
import { getEventAttendanceAccess } from '@/lib/eventAttendance/access';
import { eventDay, eventDayRange, PASS_TOKEN, passUrl } from '@/lib/eventAttendance/links';
import type { EventPass } from '@/lib/eventAttendance/types';
import { qrDataUrls } from '@/lib/links';
import { createAdminClient } from '@/lib/supabase/admin';
import { EventFrame } from '../../../EventFrame';
import { StaffCheckIn } from './StaffCheckIn';

/**
 * A person's pass for a project's event: /event/pass/<token> (0075). The
 * token is the only key, so whoever holds the link sees the pass: the name,
 * the QR code the gate reads, and the days already attended. Nothing else
 * about the person is shown (no mobile, no email).
 *
 * The QR code holds this page's own address. A manager or an HR member who
 * reads it with their phone's ordinary camera lands here signed in, and gets
 * a "Check in" button: the gate works without the in-app scanner too.
 */
export default async function EventPassPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale, token } = await params;
  const { new: justRegistered } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('eventAttendance');

  let pass: EventPass | undefined;
  if (PASS_TOKEN.test(token)) {
    // An error (0075 not applied yet) reads the same as an unknown link.
    const { data } = await createAdminClient().rpc('event_pass', { p_token: token });
    pass = (data as EventPass[] | null)?.[0];
  }

  if (!pass) {
    return (
      <EventFrame theme={null} name={t('name')}>
        <Alert tone="warn">{t('pass.notFound')}</Alert>
      </EventFrame>
    );
  }

  const eventName = locale === 'ar' ? pass.name_ar : pass.name_en;
  if (pass.cancelled) {
    return (
      <EventFrame theme={pass.theme} name={eventName}>
        <Alert tone="warn">{t('pass.cancelled')}</Alert>
      </EventFrame>
    );
  }

  const [qr, staff] = await Promise.all([
    qrDataUrls(passUrl(locale, token)),
    // Null for the attendee themselves, and for anyone not signed in.
    getEventAttendanceAccess(pass.project_id),
  ]);
  const days = eventDayRange(pass.first_day, pass.last_day, locale);

  return (
    <EventFrame theme={pass.theme} name={eventName}>
      <div className="space-y-4">
        {justRegistered ? <Alert tone="ok">{t('pass.registered')}</Alert> : null}

        {staff ? <StaffCheckIn projectId={pass.project_id} locale={locale} token={token} /> : null}

        <Card className="space-y-4 text-center">
          <div>
            <p className="text-sm text-ink-muted">{eventName}</p>
            <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight text-ink">{pass.name}</h1>
            {days ? <p className="mt-1 text-sm text-ink-muted">{days}</p> : null}
          </div>

          {/* A data URL made on the server: nothing for next/image to optimise.
              White behind it whatever the theme: a scanner needs the contrast. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr.svg}
            alt={t('pass.qrAlt')}
            width={260}
            height={260}
            className="mx-auto size-64 max-w-full rounded-xl border border-line"
          />

          <p className="text-sm text-ink">{t('pass.show')}</p>
          <a
            href={qr.png}
            download="event-pass.png"
            className="inline-flex items-center justify-center rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-muted"
          >
            {t('pass.download')}
          </a>
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold text-ink">{t('pass.attended')}</h2>
          {pass.days.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('pass.attendedNone')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {pass.days.map((day) => (
                <li key={day}>
                  <Badge tone="ok">{eventDay(day, locale)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </EventFrame>
  );
}
