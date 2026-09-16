import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { StatTile } from '@/components/charts/BarList';
import { Badge, Card, EmptyState } from '@/components/ui';
import { formatDateTime, localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { siteUrl } from '@/lib/interviews/email';
import {
  countActiveBookings,
  countApplications,
  loadCompanies,
  loadCounters,
  loadRooms,
  loadSessions,
} from '@/lib/interviews/queries';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { CopyField } from './CopyField';

/** A window is open when now is inside it; null bounds mean closed. */
function gateState(opens: string | null, closes: string | null): 'open' | 'closed' | 'upcoming' {
  if (!opens || !closes) return 'closed';
  const now = new Date().getTime();
  if (now < new Date(opens).getTime()) return 'upcoming';
  if (now >= new Date(closes).getTime()) return 'closed';
  return 'open';
}

export default async function InterviewsOverviewPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, role } = access;

  const t = await getTranslations('interviews');
  const db = createInterviewsClient();

  const [applications, bookings, companies, rooms, sessions, counters, accepted] =
    await Promise.all([
      countApplications(db, edition.id),
      countActiveBookings(db, edition.id),
      loadCompanies(db, edition.id),
      loadRooms(db, edition.id),
      loadSessions(db, edition.id),
      loadCounters(db, edition.id),
      db
        .from('application_preferences')
        .select('application_id')
        .eq('edition_id', edition.id)
        .eq('decision', 'accepted'),
    ]);

  const acceptedStudents = new Set((accepted.data ?? []).map((r) => r.application_id as string)).size;
  const slotsTotal = [...counters.values()].reduce((sum, c) => sum + Number(c.slots_total), 0);

  const applyState = gateState(edition.apply_opens_at, edition.apply_closes_at);
  const bookingState = gateState(edition.booking_opens_at, edition.booking_closes_at);
  const gateTone = { open: 'ok', upcoming: 'warn', closed: 'neutral' } as const;

  const base = `/projects/${id}/interviews`;
  const applyUrl = `${siteUrl()}/${locale}/interviews/apply/${edition.public_slug}`;
  const tvUrl = edition.tv_token ? `${siteUrl()}/${locale}/interviews/tv/${edition.tv_token}` : null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* ---- the two gates ---- */}
      <Card>
        <h2 className="mb-3 font-semibold">{t('overview.gates')}</h2>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="flex items-center justify-between gap-2">
              <span className="font-medium">{t('overview.applications')}</span>
              <Badge tone={gateTone[applyState]}>{t(`gate.${applyState}`)}</Badge>
            </dt>
            <dd className="mt-1 text-xs text-ink-muted">
              {edition.apply_opens_at && edition.apply_closes_at
                ? `${formatDateTime(edition.apply_opens_at, locale)} → ${formatDateTime(edition.apply_closes_at, locale)}`
                : t('overview.noWindow')}
            </dd>
          </div>
          <div>
            <dt className="flex items-center justify-between gap-2">
              <span className="font-medium">{t('overview.booking')}</span>
              <Badge tone={gateTone[bookingState]}>{t(`gate.${bookingState}`)}</Badge>
            </dt>
            <dd className="mt-1 text-xs text-ink-muted">
              {edition.booking_opens_at && edition.booking_closes_at
                ? `${formatDateTime(edition.booking_opens_at, locale)} → ${formatDateTime(edition.booking_closes_at, locale)}`
                : t('overview.noWindow')}
            </dd>
          </div>
        </dl>
        {can.manage(role) ? (
          <Link href={`${base}/settings`} className="mt-3 inline-block text-sm text-brand-600 hover:underline">
            {t('overview.changeGates')}
          </Link>
        ) : null}
      </Card>

      {/* ---- the numbers ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
        <StatTile label={t('overview.applied')} value={String(applications)} />
        <StatTile label={t('overview.acceptedStudents')} value={String(acceptedStudents)} />
        <StatTile
          label={t('overview.booked')}
          value={String(bookings)}
          hint={t('overview.ofSlots', { slots: slotsTotal })}
        />
        <StatTile
          label={t('overview.setup')}
          value={`${companies.length} · ${rooms.length} · ${sessions.length}`}
          hint={t('overview.setupHint')}
        />
      </div>

      {/* ---- links ---- */}
      <Card className="lg:col-span-3">
        <h2 className="mb-1 font-semibold">{t('overview.links')}</h2>
        <p className="mb-3 text-xs text-ink-muted">{t('overview.linksHint')}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <CopyField label={t('overview.applyLink')} value={applyUrl} />
          {can.manage(role) && tvUrl ? <CopyField label={t('overview.tvLink')} value={tvUrl} /> : null}
        </div>
      </Card>

      {/* ---- per company ---- */}
      <Card className="lg:col-span-3">
        <h2 className="mb-3 font-semibold">{t('overview.perCompany')}</h2>
        {companies.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-muted">
                <tr className="border-b border-line text-start">
                  <th className="py-2 pe-3 text-start font-medium">{t('company')}</th>
                  <th className="py-2 pe-3 text-start font-medium">{t('decision.pending')}</th>
                  <th className="py-2 pe-3 text-start font-medium">{t('decision.accepted')}</th>
                  <th className="py-2 pe-3 text-start font-medium">{t('decision.rejected')}</th>
                  <th className="py-2 text-start font-medium">{t('overview.bookedOfSlots')}</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => {
                  const c = counters.get(company.id);
                  return (
                    <tr key={company.id} className="border-b border-line last:border-0">
                      <td className="py-2 pe-3">
                        <span className="font-medium">{localized(company, 'name', locale)}</span>
                        {company.is_hidden ? <Badge>{t('companies.hidden')}</Badge> : null}
                      </td>
                      <td className="ltr-nums py-2 pe-3">{c?.pending ?? 0}</td>
                      <td className="ltr-nums py-2 pe-3">{c?.accepted ?? 0}</td>
                      <td className="ltr-nums py-2 pe-3">{c?.rejected ?? 0}</td>
                      <td className="ltr-nums py-2">
                        {c?.slots_booked ?? 0} / {c?.slots_total ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>{t('companies.empty')}</EmptyState>
        )}
      </Card>
    </div>
  );
}
