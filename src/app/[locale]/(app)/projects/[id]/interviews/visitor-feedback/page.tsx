import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Card, EmptyState } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { VISITOR_QUESTIONS, VISITOR_SCALE, loadVisitorSummary, visitorFeedbackOpen } from '@/lib/interviews/visitorFeedback';
import { createInterviewsClient } from '@/lib/supabase/interviews';

/**
 * What the students who checked in said about the event (0018): for each
 * question how many chose each answer, and the written comments. HR and the
 * managers, and the Development team (0072, read only); the link itself is
 * switched on in Settings. The answers are anonymous (0019); no names are
 * shown, even for answers given with a phone before that.
 */
export default async function VisitorFeedbackResultsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, settings, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  if (!can.visitorResults(role)) return <EmptyState>{tCommon('notPermitted')}</EmptyState>;

  const summary = await loadVisitorSummary(createInterviewsClient(), edition.id);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('visitorFeedback.resultsTitle')}</h2>
        <p className="text-sm text-ink-muted">
          {t('visitorFeedback.responses', { count: summary.total })} ·{' '}
          {visitorFeedbackOpen(settings) ? t('walkinSettings.open') : t('walkinSettings.closed')}
        </p>
      </div>

      {!summary.ready ? <Alert tone="info">{t('visitorFeedback.needs0018')}</Alert> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {VISITOR_QUESTIONS.map((q) => (
          <Card key={q}>
            <h3 className="mb-3 text-sm font-medium">{t(`visitorFeedback.q.${q}`)}</h3>
            <ul className="space-y-2">
              {VISITOR_SCALE.map((n) => {
                const count = summary.counts[q][n] ?? 0;
                const share = summary.total ? Math.round((count / summary.total) * 100) : 0;
                return (
                  <li key={n} className="text-sm">
                    <div className="mb-1 flex justify-between gap-2">
                      <span>{t(`visitorFeedback.scale.${n}`)}</span>
                      <span className="ltr-nums text-ink-muted">
                        {count} · {share}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-muted">
                      <div className="h-2 rounded-full bg-brand-600" style={{ width: `${share}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <Card>
        <h3 className="mb-3 text-sm font-medium">{t('visitorFeedback.comments')}</h3>
        {summary.comments.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('visitorFeedback.noComments')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {summary.comments.map((c, i) => (
              <li key={i} className="py-2 text-sm">
                <p className="whitespace-pre-line">{c.comment}</p>
                <p className="mt-1 text-xs text-ink-muted">{formatDateTime(c.at, locale)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
