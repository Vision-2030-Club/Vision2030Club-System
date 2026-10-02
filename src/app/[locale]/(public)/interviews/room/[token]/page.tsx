import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui';
import { localized } from '@/lib/format';
import { findRoomByToken } from '@/lib/interviews/roomLinks';
import { isToken } from '@/lib/interviews/tokens';
import type { Company } from '@/lib/interviews/types';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { RoomLoginForm } from './RoomLoginForm';

/**
 * One room's public face: a student identifies themselves with their name,
 * phone, the email they applied with, and a CV, and, if HR accepted them for
 * this room's company, is sent straight to their booking page (actions.ts).
 * The link's token is kept in the edition's settings (roomLinks.ts), not in
 * 0005's `candidate_token`, so it works without that migration.
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
  const [{ data }, { data: session }] = await Promise.all([
    db.from('companies').select('*').eq('id', room.companyId).maybeSingle(),
    db.from('sessions').select('room_id, rooms(name)').eq('company_id', room.companyId).limit(1).maybeSingle(),
  ]);
  const company = data as Company | null;
  const joined = (session as { rooms: { name: string } | { name: string }[] | null } | null)?.rooms;
  const roomName = (Array.isArray(joined) ? joined[0] : joined)?.name ?? null;
  // is_hidden doubles as "deleted" for a room (setRoomDeletedAction) — a
  // deleted room's link stops working, even though its data is untouched.
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
          {roomName ? <p className="text-sm text-ink-muted">{roomName}</p> : null}
        </div>
      </div>
      <p className="mb-5 text-sm text-ink-muted">{t('room.intro')}</p>
      <Card>
        <RoomLoginForm locale={locale} token={token} />
      </Card>
    </>
  );
}
