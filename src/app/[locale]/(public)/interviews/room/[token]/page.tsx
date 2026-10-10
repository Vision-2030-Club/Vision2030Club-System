import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui';
import { formatDate, localized } from '@/lib/format';
import { findRoomByToken } from '@/lib/interviews/roomLinks';
import { isToken } from '@/lib/interviews/tokens';
import type { Company } from '@/lib/interviews/types';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { RoomLoginForm } from './RoomLoginForm';

/**
 * One assignment's public face (a company in a room on one day): a student
 * identifies themselves with their name, phone, email and a CV, and, if HR
 * put them on this assignment's accepted list, is sent straight to their
 * booking page (actions.ts). The link's token is kept in the edition's
 * settings (roomLinks.ts); an older per-company link still opens here.
 */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('interviews');

  if (!isInterviewsConfigured()) notFound();
  const db = createInterviewsClient();

  const room = isToken(token) ? await findRoomByToken(db, token) : null;
  if (!room) notFound();
  // An assignment's link names its own room and day; an older company link
  // names the company's first room.
  const sessionQuery = db.from('sessions').select('day, room_id, rooms(name)');
  const [{ data }, { data: session }] = await Promise.all([
    db.from('companies').select('*').eq('id', room.companyId).maybeSingle(),
    room.sessionId
      ? sessionQuery.eq('id', room.sessionId).maybeSingle()
      : sessionQuery.eq('company_id', room.companyId).limit(1).maybeSingle(),
  ]);
  const company = data as Company | null;
  type Joined = { day: string; rooms: { name: string } | { name: string }[] | null } | null;
  const joined = (session as Joined)?.rooms;
  const roomName = (Array.isArray(joined) ? joined[0] : joined)?.name ?? null;
  const day = room.sessionId && session ? formatDate(`${(session as NonNullable<Joined>).day}T12:00:00Z`, locale) : null;
  // is_hidden is a removed company (setCompanyHiddenAction): its link
  // stops working, even though its data is untouched.
  if (!company || company.is_hidden) notFound();

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        {company.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logo_url}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-lg border border-line bg-surface-muted object-contain p-1"
          />
        ) : null}
        <div>
          <h1 className="text-2xl font-semibold text-ink">{localized(company, 'name', locale)}</h1>
          {roomName ? (
            <p className="ltr-nums text-sm text-ink-muted">
              {roomName}
              {day ? ` · ${day}` : ''}
            </p>
          ) : null}
        </div>
      </div>
      <p className="mb-5 text-sm text-ink-muted">{t('room.intro')}</p>
      <Card>
        <RoomLoginForm locale={locale} token={token} />
      </Card>
    </>
  );
}
