import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { eventDay } from '@/lib/eventAttendance/links';
import { localized } from '@/lib/format';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import type { ChallengeRow } from '@/lib/quroosh/challenges';
import { formatQuroosh } from '@/lib/quroosh/wallet';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { saveChallengeAction } from './actions';
import { ChallengeFields } from './ChallengeFields';

/**
 * The booths' challenges of the project's Quroosh event (Quroosh 0008), for
 * its managers only: every challenge with how many played it, and making a
 * new one. A challenge's questions and its QR code are on its own page.
 */
export default async function QurooshChallengesPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getQurooshAccess(id);
  if (!access || !can.manage(access.role)) notFound();

  const t = await getTranslations('quroosh');
  const header = <PageHeader title={t('challenges.title')} description={localized(access.project, 'name', locale)} />;
  if (!isQurooshConfigured()) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('applications.notConfigured')}</Alert>
      </>
    );
  }

  const { data, error } = await createQurooshClient().rpc('challenge_list', { p_project: id });
  // Before 0008 is applied the function does not exist: say so, do not crash.
  if (error) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('challenges.notReady')}</Alert>
      </>
    );
  }
  const challenges = (data ?? []) as ChallengeRow[];

  return (
    <div className="space-y-6">
      {header}
      <p className="text-sm text-ink-muted">{t('challenges.intro')}</p>

      {challenges.length === 0 ? (
        <EmptyState>{t('challenges.empty')}</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
          {challenges.map((challenge) => {
            const questions = Number(challenge.questions);
            return (
              <li key={challenge.id}>
                <Link
                  href={`/projects/${id}/quroosh/challenges/${challenge.id}`}
                  className="block space-y-2 p-4 hover:bg-surface-muted"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-ink">{challenge.booth}</span>
                    {challenge.active ? null : <Badge tone="neutral">{t('challenges.off')}</Badge>}
                    {questions === 0 ? <Badge tone="warn">{t('challenges.noQuestions')}</Badge> : null}
                    <span className="ms-auto text-xs text-ink-muted">
                      {challenge.day ? eventDay(challenge.day, locale) : t('challenges.everyDay')}
                    </span>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {[
                      challenge.topic,
                      t('challenges.questionCount', { count: questions }),
                      t('challenges.played', { count: Number(challenge.attempts) }),
                      Number(challenge.attempts) > 0
                        ? t('challenges.average', { points: formatQuroosh(challenge.average_points) })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Card className="space-y-4">
        <h2 className="font-semibold text-ink">{t('challenges.newTitle')}</h2>
        <ActionForm action={saveChallengeAction} submitLabel={t('challenges.create')}>
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="locale" value={locale} />
          <ChallengeFields prefix="new" />
          <p className="text-xs text-ink-muted">{t('challenges.newHint')}</p>
        </ActionForm>
      </Card>
    </div>
  );
}
