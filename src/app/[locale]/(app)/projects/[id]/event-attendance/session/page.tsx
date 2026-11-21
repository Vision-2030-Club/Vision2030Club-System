import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StatTile } from '@/components/charts/BarList';
import { Alert, Card, PageHeader } from '@/components/ui';
import { getEventAttendanceAccess } from '@/lib/eventAttendance/access';
import { eventDay } from '@/lib/eventAttendance/links';
import { localized } from '@/lib/format';
import { qrDataUrls } from '@/lib/links';
import { getSessionPoints, getSessionSummary, sessionCheckInUrl } from '@/lib/quroosh/sessions';
import { formatQuroosh } from '@/lib/quroosh/wallet';
import { CLUB_TIME_ZONE } from '@/lib/time';
import { CopyField } from '../../interviews/CopyField';

/**
 * تسجيل حضور للجلسة: the dialogue session's QR code (Quroosh 0009), for the
 * project's managers and the HR team, to show on the screen at the session
 * or print. It is permanent: one code per project, holding
 * /quroosh/checkin/<project id>, which never expires or changes. A guest who
 * opens it signs in, rates the session and checks in once a day, and their
 * Quroosh wallet is paid.
 *
 * Below the code, how many checked in and the average rating, day by day:
 * counts only, no names, so the HR team may see them too.
 */
export default async function SessionCheckInQrPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getEventAttendanceAccess(id);
  if (!access) notFound();

  const t = await getTranslations('eventAttendance.session');
  const link = sessionCheckInUrl(locale, id);
  const [qr, summary, points] = await Promise.all([qrDataUrls(link), getSessionSummary(id), getSessionPoints(id)]);

  // The day on the club's clock, as the Quroosh database writes it.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: CLUB_TIME_ZONE }).format(new Date());
  const todayRow = summary?.find((row) => row.day === today);

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={localized(access.project, 'name', locale)} />

      {summary === null ? <Alert tone="warn">{t('notReady')}</Alert> : null}

      <Card className="space-y-5">
        <div>
          <h2 className="font-semibold text-ink">{t('qrTitle')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{t('qrHint')}</p>
        </div>

        {/* The code opens the check-in page when pressed, as well as when scanned. */}
        <a
          href={link}
          target="_blank"
          rel="noopener"
          className="mx-auto block w-fit rounded-2xl border border-line bg-surface p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          aria-label={t('qrOpen')}
        >
          {/* A data URL made on the server: nothing for next/image to optimise. The
              picture stays dark on white whatever the theme, so phones can read it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.svg} alt={t('qrAlt')} width={256} height={256} className="size-56 sm:size-64" />
        </a>

        <div className="mx-auto max-w-md space-y-3">
          <CopyField label={t('link')} value={link} />
          <a
            href={qr.png}
            download="session-check-in-qr.png"
            className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t('download')}
          </a>
          <p className="text-xs text-ink-muted">{t('permanent')}</p>
        </div>
      </Card>

      {summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label={t('today')} value={String(todayRow?.check_ins ?? 0)} tone="ok" />
            <StatTile
              label={t('averageToday')}
              // Isolated left to right, or Arabic shows "5 / 4.6".
              value={todayRow ? `\u2066${todayRow.average_rating.toFixed(1)} / 5\u2069` : '—'}
            />
            <StatTile label={t('reward')} value={points === null ? '—' : formatQuroosh(points)} hint={t('rewardHint')} />
          </div>

          <Card>
            <h2 className="mb-3 font-semibold text-ink">{t('byDay')}</h2>
            {summary.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('none')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {summary.map((row) => (
                  <li key={row.day} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-ink">
                      {eventDay(row.day, locale)}
                      {row.day === today ? <span className="ms-2 text-xs text-ink-muted">{t('todayTag')}</span> : null}
                    </span>
                    <span className="flex items-center gap-4">
                      <span className="text-ink-muted">
                        {t('average')}{' '}
                        <span className="ltr-nums font-semibold tabular-nums text-ink">
                          {row.average_rating.toFixed(1)}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums text-ink">
                        {t('count', { count: row.check_ins })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
