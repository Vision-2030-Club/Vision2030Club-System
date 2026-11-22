import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Card } from '@/components/ui';
import { UUID } from '@/lib/eventAttendance/api';
import { eventDayRange } from '@/lib/eventAttendance/links';
import type { EventPublic } from '@/lib/eventAttendance/types';
import { COUNTRIES } from '@/lib/quroosh/phones';
import { createAdminClient } from '@/lib/supabase/admin';
import { QurooshCard, QurooshNote } from '@/components/QurooshHero';
import { EventFrame } from '../../../EventFrame';
import { JoinForm } from './JoinForm';

/**
 * The public sign-up form of a project's event: /event/join/<club project
 * id> (0075). Anyone may open it. `event_public` says whether the project
 * carries Event attendance and whether sign-up is open; it returns nothing
 * about anyone who signed up.
 */
export default async function EventJoinPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('eventAttendance');

  let event: EventPublic | undefined;
  if (UUID.test(projectId)) {
    // An error (0075 not applied yet) reads the same as no such event.
    const { data } = await createAdminClient().rpc('event_public', { p_project: projectId });
    event = (data as EventPublic[] | null)?.[0];
  }

  if (!event) {
    return (
      <EventFrame theme={null} name={t('name')}>
        <Alert tone="warn">{t('join.notFound')}</Alert>
      </EventFrame>
    );
  }

  const name = locale === 'ar' ? event.name_ar : event.name_en;
  const quroosh = event.theme === 'quroosh';
  const days = eventDayRange(event.first_day, event.last_day, locale);
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  const countries = COUNTRIES.map(([iso, dial]) => ({ iso, dial, name: regionNames.of(iso) ?? iso }));

  if (quroosh) {
    // Quroosh: the identity's page design. The title and the intro sit in the
    // navy hero; the form is a white card on the light page.
    return (
      <EventFrame theme={event.theme} name={name} title={t('join.title', { event: name })} subtitle={t('join.intro')}>
        {event.signup_open ? (
          <QurooshCard icon={<TicketIcon />} title={t('join.cardTitle')}>
            <JoinForm projectId={projectId} locale={locale} countries={countries} />
          </QurooshCard>
        ) : (
          <Alert tone="warn">{t('join.closed')}</Alert>
        )}
        {days ? <QurooshNote>{t('join.days', { days })}</QurooshNote> : null}
      </EventFrame>
    );
  }

  return (
    <EventFrame theme={event.theme} name={name}>
      <div className="space-y-5">
        <div>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink">{t('join.title', { event: name })}</h1>
          <p className="mt-2 text-sm text-ink-muted">{t('join.intro')}</p>
          {days ? <p className="mt-1 text-sm font-medium text-ink">{t('join.days', { days })}</p> : null}
        </div>
        {event.signup_open ? (
          <Card>
            <JoinForm projectId={projectId} locale={locale} countries={countries} />
          </Card>
        ) : (
          <Alert tone="warn">{t('join.closed')}</Alert>
        )}
      </div>
    </EventFrame>
  );
}

function TicketIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2.5a2.5 2.5 0 0 0 0 5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5a2.5 2.5 0 0 0 0-5z" />
      <path d="M14 5v14" strokeDasharray="2 2.5" />
    </svg>
  );
}
