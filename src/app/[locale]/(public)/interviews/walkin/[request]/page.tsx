import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Card } from '@/components/ui';
import { formatTime, localized } from '@/lib/format';
import { isToken } from '@/lib/interviews/tokens';
import type { Company, Edition, Stage } from '@/lib/interviews/types';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { RefreshWhileWaiting } from './RefreshWhileWaiting';

/**
 * A walk-in's own page (0016), reached from the walk-in form: their number
 * to show at the desk, and once reception has answered, the company, room
 * and time, or the reason they could not be given one. The request's token
 * is the key, as a personal link is; email is not needed for any of it.
 */
export default async function WalkinStatusPage({
  params,
}: {
  params: Promise<{ locale: string; request: string }>;
}) {
  const { locale, request } = await params;
  setRequestLocale(locale);
  if (!isToken(request) || !isInterviewsConfigured()) notFound();

  const t = await getTranslations('interviews');
  const db = createInterviewsClient();
  const { data: row } = await db
    .from('walkin_requests')
    .select('seq, status, name, edition_id, company_id, booking_id, decision_note')
    .eq('request_token', request)
    .maybeSingle();
  const walkin = row as {
    seq: number;
    status: 'pending' | 'confirmed' | 'rejected';
    name: string;
    edition_id: string;
    company_id: string;
    booking_id: string | null;
    decision_note: string | null;
  } | null;
  if (!walkin) notFound();

  const [{ data: editionRow }, { data: companyRow }, { data: bookingRow }] = await Promise.all([
    db.from('editions').select('name_en, name_ar').eq('id', walkin.edition_id).maybeSingle(),
    db.from('companies').select('name_en, name_ar').eq('id', walkin.company_id).maybeSingle(),
    walkin.booking_id
      ? db
          .from('bookings')
          .select('starts_at, stage, cancelled_at, slots(rooms(name))')
          .eq('id', walkin.booking_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const edition = editionRow as Pick<Edition, 'name_en' | 'name_ar'> | null;
  const company = localized(companyRow as Pick<Company, 'name_en' | 'name_ar'> | null, 'name', locale);
  const booking = bookingRow as unknown as {
    starts_at: string;
    stage: Stage;
    cancelled_at: string | null;
    slots: { rooms: { name: string } | null } | null;
  } | null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink">{localized(edition, 'name', locale)}</h1>
      <Card>
        <div className="space-y-3 text-center">
          <p className="text-sm text-ink-muted">{t('walkinStatus.number')}</p>
          <p className="ltr-nums text-5xl font-bold text-brand-700">#{walkin.seq}</p>
          <p className="font-medium">
            {walkin.name} · {company}
          </p>
        </div>
      </Card>

      {walkin.status === 'pending' ? (
        <>
          <Alert tone="info">{t('walkinStatus.waiting')}</Alert>
          <RefreshWhileWaiting />
        </>
      ) : walkin.status === 'confirmed' && booking && !booking.cancelled_at ? (
        <Alert tone="ok">
          {t('walkinStatus.confirmed', {
            company,
            room: booking.slots?.rooms?.name ?? '',
            time: formatTime(booking.starts_at, locale),
          })}
        </Alert>
      ) : (
        <Alert tone="warn">
          {t('walkinStatus.rejected')}
          {walkin.decision_note ? ` ${walkin.decision_note}` : ''}
        </Alert>
      )}
    </div>
  );
}
