import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Card } from '@/components/ui';
import { localized } from '@/lib/format';
import { resolveApplyFields } from '@/lib/interviews/applyFields';
import { loadCompanies, loadSessions } from '@/lib/interviews/queries';
import { isToken } from '@/lib/interviews/tokens';
import type { EditionSettings } from '@/lib/interviews/types';
import { editionByWalkinToken, editionToday, loadWalkinSlots, walkinSettings } from '@/lib/interviews/walkins';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { WalkinForm } from './WalkinForm';

/**
 * The walk-in link (0016): the QR code at the venue. Today's companies, each
 * choosable only while it has a free time later today (walkin_slots); the
 * database checks the same again when the form is sent. Closed whenever the
 * club switches walk-ins off in Settings.
 */
export default async function WalkinPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  if (!isToken(token) || !isInterviewsConfigured()) notFound();

  const t = await getTranslations('interviews');
  const db = createInterviewsClient();
  const edition = await editionByWalkinToken(db, token);
  if (!edition) notFound();

  const title = localized(edition, 'name', locale);
  const { data } = await db.rpc('edition_settings', { p_edition: edition.id });
  const settings = data as EditionSettings | null;
  const walkins = walkinSettings(settings);

  const notice = (text: string) => (
    <>
      <h1 className="mb-2 text-2xl font-semibold text-ink">{title}</h1>
      <Alert tone="info">{text}</Alert>
    </>
  );

  if (edition.status === 'archived' || !walkins.open) return notice(t('walkinForm.closed'));

  const today = editionToday(edition);
  const [companies, sessions, slots] = await Promise.all([
    loadCompanies(db, edition.id),
    loadSessions(db, edition.id, today),
    loadWalkinSlots(db, edition.id),
  ]);
  if (slots === null) return notice(t('errors.not_configured'));

  const off = new Set(walkins.offCompanies);
  const todays = companies.filter(
    (c) => !c.is_hidden && !off.has(c.id) && sessions.some((s) => s.company_id === c.id),
  );
  const open = new Set(slots.map((s) => s.company_id));
  if (todays.length === 0) return notice(t('walkinForm.noneToday'));
  if (!todays.some((c) => open.has(c.id))) return notice(t('walkinForm.allFull'));

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold text-ink">{title}</h1>
      <p className="mb-5 text-sm text-ink-muted">{t('walkinForm.intro')}</p>
      <Card>
        <WalkinForm
          token={token}
          locale={locale}
          fields={resolveApplyFields(settings?.apply_fields)}
          companies={todays.map((c) => ({
            id: c.id,
            name: localized(c, 'name', locale),
            description: localized(c, 'desc', locale),
            logo_url: c.logo_url,
            is_full: !open.has(c.id),
          }))}
        />
      </Card>
    </>
  );
}
