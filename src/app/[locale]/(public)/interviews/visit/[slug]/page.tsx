import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Card } from '@/components/ui';
import { localized } from '@/lib/format';
import type { Edition, EditionSettings } from '@/lib/interviews/types';
import { visitorFeedbackOpen } from '@/lib/interviews/visitorFeedback';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { VisitorFeedbackForm } from './VisitorFeedbackForm';

/**
 * Visitor feedback (0018): the link students who came to the event open, by
 * the edition's public slug like the apply form. Closed unless the club
 * switched it on in Settings; who may answer is checked by the database
 * (the phone of someone who checked in).
 */
export default async function VisitorFeedbackPage({
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

  const title = localized(edition, 'name', locale);
  const { data: settings } = await db.rpc('edition_settings', { p_edition: edition.id });
  const open = edition.status !== 'archived' && visitorFeedbackOpen(settings as EditionSettings | null);

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold text-ink">{t('visitorFeedback.title')}</h1>
      <p className="mb-5 text-sm text-ink-muted">{title}</p>
      {open ? (
        <Card>
          <p className="mb-4 text-sm text-ink-muted">{t('visitorFeedback.intro')}</p>
          <VisitorFeedbackForm slug={slug} locale={locale} />
        </Card>
      ) : (
        <Alert tone="info">{t('visitorFeedback.closed')}</Alert>
      )}
    </>
  );
}
