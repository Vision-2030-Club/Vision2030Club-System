import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { StatTile } from '@/components/charts/BarList';
import { Alert, Badge, Card, Input, Label, PageHeader } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { can, getEventAttendanceAccess } from '@/lib/eventAttendance/access';
import { isApiConfigured } from '@/lib/eventAttendance/api';
import { isEmailConfigured } from '@/lib/eventAttendance/email';
import { eventDay, joinUrl } from '@/lib/eventAttendance/links';
import type { EventSummary } from '@/lib/eventAttendance/types';
import { localized } from '@/lib/format';
import { qrDataUrls } from '@/lib/links';
import { createClient } from '@/lib/supabase/server';
import { CopyField } from '../interviews/CopyField';
import { saveSettingsAction } from './actions';

/**
 * Event attendance (0075), first page: how many signed up and how many came,
 * day by day. The numbers are for everyone who may open the component (the
 * project's managers and the HR team). Below them, for managers only: the
 * sign-up link and its QR code for the gate, and the settings (sign-up open
 * or closed, the event's days).
 */
export default async function EventAttendancePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getEventAttendanceAccess(id);
  if (!access) notFound();

  const t = await getTranslations('eventAttendance');
  const header = <PageHeader title={t('name')} description={localized(access.project, 'name', locale)} />;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('event_attendance_summary', { p_project: id });
  // Before 0075 is applied the function does not exist: say so, do not crash.
  if (error || !data) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('notReady')}</Alert>
      </>
    );
  }
  const summary = data as EventSummary;
  const manager = can.manage(access.role);
  const signUpLink = joinUrl(locale, id);
  const qr = manager ? await qrDataUrls(signUpLink) : null;
  const scanHref = `/projects/${id}/event-attendance/scan`;

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label={t('overview.attendees')}
          value={String(summary.attendees)}
          hint={summary.cancelled > 0 ? t('overview.cancelledHint', { count: summary.cancelled }) : undefined}
        />
        <StatTile label={t('overview.checkedInToday')} value={String(summary.checked_in_today)} tone="ok" />
        <StatTile
          label={t('overview.passesWaiting')}
          value={String(summary.passes_waiting)}
          tone={summary.passes_waiting > 0 ? 'warn' : 'neutral'}
          hint={t('overview.passesWaitingHint')}
        />
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{t('scan.title')}</p>
          <p className="mt-1 text-xs text-ink-muted">{t('overview.scannerHint')}</p>
        </div>
        <Link
          href={scanHref}
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t('overview.openScanner')}
        </Link>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-ink">{t('overview.byDay')}</h2>
        {summary.days.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('overview.noCheckIns')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {summary.days.map(({ day, count }) => (
              <li key={day} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-ink">
                  {eventDay(day, locale)}
                  {day === summary.today ? <span className="ms-2 text-xs text-ink-muted">{t('overview.today')}</span> : null}
                </span>
                <span className="ltr-nums font-semibold tabular-nums text-ink">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {manager && qr ? (
        <>
          {isEmailConfigured() ? null : <Alert tone="warn">{t('overview.emailOff')}</Alert>}

          <Card className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-ink">{t('overview.signupLink')}</h2>
              <Badge tone={summary.signup_open ? 'ok' : 'neutral'}>
                {summary.signup_open ? t('overview.statusOpen') : t('overview.statusClosed')}
              </Badge>
            </div>
            <p className="text-xs text-ink-muted">{t('overview.signupLinkHint')}</p>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {/* A data URL made on the server: nothing for next/image to optimise. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr.svg}
                alt={t('overview.qrAlt')}
                width={144}
                height={144}
                className="size-36 shrink-0 rounded-lg border border-line"
              />
              <div className="min-w-0 flex-1 space-y-3">
                <CopyField label={t('overview.signupLink')} value={signUpLink} />
                <a
                  href={qr.png}
                  download="event-sign-up-qr.png"
                  className="inline-flex items-center justify-center rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-muted"
                >
                  {t('overview.qrDownload')}
                </a>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold text-ink">{t('overview.settings.title')}</h2>
            <ActionForm action={saveSettingsAction} submitLabel={t('overview.settings.save')}>
              <input type="hidden" name="project_id" value={id} />
              <input type="hidden" name="locale" value={locale} />
              <label className="flex items-start gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  name="signup_open"
                  defaultChecked={summary.signup_open}
                  className="mt-0.5 size-4 accent-brand-600"
                />
                <span>
                  <span className="font-medium">{t('overview.settings.signupOpen')}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{t('overview.settings.signupOpenHint')}</span>
                </span>
              </label>
              <div className="grid max-w-md gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="first_day">{t('overview.settings.firstDay')}</Label>
                  <Input id="first_day" name="first_day" type="date" defaultValue={summary.first_day ?? ''} />
                </div>
                <div>
                  <Label htmlFor="last_day">{t('overview.settings.lastDay')}</Label>
                  <Input id="last_day" name="last_day" type="date" defaultValue={summary.last_day ?? ''} />
                </div>
              </div>
              <p className="text-xs text-ink-muted">{t('overview.settings.daysHint')}</p>
            </ActionForm>
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold text-ink">{t('overview.api.title')}</h2>
            <p className="text-sm text-ink-muted">
              {isApiConfigured() ? t('overview.api.on') : t('overview.api.off')}
            </p>
            <p className="ltr-nums mt-2 break-all text-xs text-ink-muted" dir="ltr">
              /api/event-attendance/{id}/attendees · /api/event-attendance/{id}/check-ins
            </p>
          </Card>
        </>
      ) : null}
    </div>
  );
}
