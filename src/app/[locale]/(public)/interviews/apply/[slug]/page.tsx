import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Card } from '@/components/ui';
import { formatDateTime, localized } from '@/lib/format';
import { loadCompanies } from '@/lib/interviews/queries';
import type { Edition, EditionSettings } from '@/lib/interviews/types';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { ApplyForm } from './ApplyForm';

/**
 * The one form a student fills in. Reachable by anyone with the link; the
 * database decides whether applications are open (submit_application refuses
 * outside the window), and this page only says so nicely beforehand.
 */
export default async function ApplyPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('interviews');

  if (!isInterviewsConfigured()) notFound();
  const db = createInterviewsClient();

  const { data } = await db.from('editions').select('*').eq('public_slug', slug).maybeSingle();
  const edition = data as Edition | null;
  if (!edition) notFound();

  const now = new Date().getTime();
  const opens = edition.apply_opens_at ? new Date(edition.apply_opens_at).getTime() : null;
  const closes = edition.apply_closes_at ? new Date(edition.apply_closes_at).getTime() : null;
  const open = edition.status === 'active' && opens !== null && closes !== null && now >= opens && now < closes;

  const title = localized(edition, 'name', locale);

  if (!open) {
    const notYet = edition.status === 'active' && opens !== null && now < opens;
    return (
      <>
        <h1 className="mb-2 text-2xl font-semibold text-ink">{title}</h1>
        <Alert tone="info">
          {notYet
            ? t('apply.notYet', { when: formatDateTime(edition.apply_opens_at, locale) })
            : t('apply.closed')}
        </Alert>
      </>
    );
  }

  const [companies, { data: settings }] = await Promise.all([
    loadCompanies(db, edition.id),
    db.rpc('edition_settings', { p_edition: edition.id }),
  ]);
  const maxPreferences = (settings as EditionSettings | null)?.max_preferences ?? 4;

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold text-ink">{title}</h1>
      <p className="mb-5 text-sm text-ink-muted">
        {t('apply.intro', { max: maxPreferences })}{' '}
        {t('apply.closesAt', { when: formatDateTime(edition.apply_closes_at, locale) })}
      </p>
      <Card>
        <ApplyForm
          locale={locale}
          editionId={edition.id}
          maxPreferences={maxPreferences}
          companies={companies
            .filter((c) => !c.is_hidden)
            .map((c) => ({
              id: c.id,
              name: localized(c, 'name', locale),
              description: localized(c, 'desc', locale),
              logo_url: c.logo_url,
            }))}
        />
      </Card>
    </>
  );
}
