import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Card } from '@/components/ui';
import { UUID } from '@/lib/eventAttendance/api';
import { eventDayRange } from '@/lib/eventAttendance/links';
import type { EventPublic } from '@/lib/eventAttendance/types';
import { COUNTRIES } from '@/lib/quroosh/phones';
import { createAdminClient } from '@/lib/supabase/admin';
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
  const days = eventDayRange(event.first_day, event.last_day, locale);
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  const countries = COUNTRIES.map(([iso, dial]) => ({ iso, dial, name: regionNames.of(iso) ?? iso }));

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
