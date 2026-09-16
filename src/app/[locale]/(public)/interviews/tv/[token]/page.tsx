import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { localized } from '@/lib/format';
import { buildBoard } from '@/lib/interviews/board';
import { loadDayRows, toBoardBookings } from '@/lib/interviews/queries';
import { isToken } from '@/lib/interviews/tokens';
import type { Edition, EditionSettings } from '@/lib/interviews/types';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';
import { TvBoard } from './TvBoard';

/**
 * The waiting-area screen. Renders once on the server with today's board and
 * then re-asks /api/interviews/board every ten seconds. Full-bleed and dark
 * on purpose: it is read from across a room, not from a chair.
 */
export default async function TvPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  if (!isToken(token) || !isInterviewsConfigured()) notFound();

  const t = await getTranslations('interviews');
  const db = createInterviewsClient();
  const { data: editionRow } = await db.from('editions').select('*').eq('tv_token', token).maybeSingle();
  const edition = editionRow as Edition | null;
  if (!edition) notFound();

  const { data: settingsRow } = await db.rpc('edition_settings', { p_edition: edition.id });
  const minutes = (settingsRow as EditionSettings | null)?.tv_call_minutes ?? 5;

  const rows = await loadDayRows(db, edition.id, toDateInput(new Date()), edition.time_zone);
  const board = buildBoard(toBoardBookings(rows), new Date().getTime(), minutes);

  return (
    <TvBoard
      locale={locale}
      title={localized(edition, 'name', locale)}
      initial={board}
      pollUrl={`/api/interviews/board?token=${token}`}
      labels={{
        nowCalling: t('tv.nowCalling'),
        proceed: t('tv.proceed'),
        upNext: t('tv.upNext'),
        room: t('tv.room'),
        inside: t('tv.inside'),
        next: t('tv.next'),
        idle: t('tv.idle'),
        quiet: t('tv.quiet'),
      }}
    />
  );
}
