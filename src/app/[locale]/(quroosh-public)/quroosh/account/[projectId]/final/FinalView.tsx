import { getTranslations } from 'next-intl/server';
import { Alert, cx } from '@/components/ui';
import { Medal, MEDALS } from '@/components/QurooshMedal';
import { FINAL_STEP, mostToGive, type FinalBoardRow, type FinalProject, type FinalStatus } from '@/lib/quroosh/final';
import { formatQuroosh } from '@/lib/quroosh/wallet';
import { GuestTabs } from '../../GuestTabs';
import { CoinIcon, GiveForm } from './GiveForm';

/**
 * What the guest's Final Wave page shows, from what the page read (see
 * page.tsx): the balance, the rules or the closed note, the top ten projects
 * and every project with its brief and the giving control. Kept apart from
 * the reads so the page's look can be checked with invented data.
 */
export async function FinalView({
  locale,
  projectId,
  status,
  projects,
  board,
  balance,
  firstGift,
}: {
  locale: string;
  projectId: string;
  /** Null before 0014 is applied. Never 'hidden': the page sends the guest away first. */
  status: FinalStatus | null;
  projects: FinalProject[] | null;
  board: FinalBoardRow[] | null;
  balance: number;
  /** The guest has not given yet: this gift is capped at 75% of the balance. */
  firstGift: boolean;
}) {
  const t = await getTranslations('quroosh.account.final');
  const open = status === 'open';
  const given = (projects ?? []).reduce((sum, project) => sum + project.mine, 0);
  const lead = board?.[0]?.received ?? 0;
  const most = mostToGive(balance, firstGift);

  return (
    <div className="mx-auto max-w-md space-y-6">
      <GuestTabs projectId={projectId} current="final" />

      <div>
        <h1 className="text-balance text-3xl font-bold tracking-tight text-ink">{t('title')}</h1>
        <p className="mt-2 text-base text-ink-muted">{open ? t('intro') : t('introClosed')}</p>
      </div>

      {status === null || projects === null ? (
        <Alert tone="warn">{t('notReady')}</Alert>
      ) : (
        <>
          {/* The balance, stuck to the top while scrolling the projects, so the
              guest always knows what they still hold. */}
          <section className="sticky top-2 z-10 flex items-center justify-between gap-4 rounded-3xl bg-brand-950 px-6 py-4 text-brand-50 shadow-xl shadow-brand-950/20">
            <div>
              <p className="text-xs font-medium text-accent-2">{t('balance')}</p>
              <p className="ltr-nums text-3xl font-bold tracking-tight text-accent tabular-nums" dir="ltr">
                {formatQuroosh(balance)}
              </p>
            </div>
            <div className="text-end">
              <p className="text-xs text-brand-200">{t('given')}</p>
              <p className="ltr-nums text-lg font-semibold tabular-nums text-brand-50" dir="ltr">
                {formatQuroosh(given)}
              </p>
            </div>
          </section>

          {open ? (
            <ul className="space-y-1.5 rounded-2xl border-2 border-dashed border-brand-200 px-5 py-4 text-sm text-ink-muted">
              <li className="flex gap-2">
                <CoinIcon className="mt-0.5 size-4 shrink-0 text-accent-3" />
                {t('rules.steps', { step: formatQuroosh(FINAL_STEP) })}
              </li>
              <li className="flex gap-2">
                <CoinIcon className="mt-0.5 size-4 shrink-0 text-accent-3" />
                {t('rules.first')}
              </li>
              <li className="flex gap-2">
                <CoinIcon className="mt-0.5 size-4 shrink-0 text-accent-3" />
                {t('rules.many')}
              </li>
              <li className="flex gap-2">
                <CoinIcon className="mt-0.5 size-4 shrink-0 text-accent-3" />
                {t('rules.place')}
              </li>
            </ul>
          ) : (
            <Alert tone="info">{t('closed')}</Alert>
          )}

          {/* The ceremony's leaderboard: the projects that collected the most. */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">{t('boardTitle')}</h2>
            {!board || board.length === 0 ? (
              <p className="rounded-2xl border-2 border-dashed border-line p-4 text-sm text-ink-muted">
                {t('boardEmpty')}
              </p>
            ) : (
              <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
                {board.map((row) => (
                  <li
                    key={row.id}
                    className={cx(
                      'space-y-2 px-4 py-3',
                      row.position <= 3 && cx('border-s-4', MEDALS[row.position - 1].strip),
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {row.position <= 3 ? (
                        <Medal place={row.position} />
                      ) : (
                        <span className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-ink-muted">
                          <span className="ltr-nums tabular-nums">{row.position}</span>
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                        {/* Names are typed by managers in either language; <bdi> keeps their punctuation right. */}
                        <bdi>{row.name}</bdi>
                      </span>
                      <span className="ltr-nums font-bold tabular-nums text-ink" dir="ltr">
                        {formatQuroosh(row.received)}
                      </span>
                    </div>
                    {/* Its share of the leader's total, as a mint bar. */}
                    <div className="ms-12 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                      <div
                        className="h-full rounded-full bg-accent-3"
                        style={{ width: `${lead > 0 ? Math.max(4, Math.round((row.received / lead) * 100)) : 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* The projects on stage, in the managers' order. */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">{t('projectsTitle')}</h2>
            {projects.length === 0 ? (
              <p className="rounded-2xl border-2 border-dashed border-line p-4 text-sm text-ink-muted">
                {t('projectsEmpty')}
              </p>
            ) : (
              <ul className="space-y-4">
                {projects.map((project, index) => (
                  <li
                    key={project.id}
                    className={cx(
                      'space-y-4 rounded-3xl border-2 bg-surface p-5 shadow-sm',
                      project.mine > 0 ? 'border-accent' : 'border-brand-200',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-950 text-accent-2">
                        <span className="ltr-nums text-sm font-bold tabular-nums">{index + 1}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-balance text-lg font-bold text-ink">
                          <bdi>{project.name}</bdi>
                        </h3>
                        {project.brief ? (
                          <p dir="auto" className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-ink-muted">
                            {project.brief}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs font-semibold">
                      <span className="rounded-full bg-surface-muted px-3 py-1.5 text-ink-muted">
                        {t('received', { amount: formatQuroosh(project.received) })}
                      </span>
                      {project.mine > 0 ? (
                        <span className="rounded-full bg-accent/30 px-3 py-1.5 text-brand-950">
                          {t('yours', { amount: formatQuroosh(project.mine) })}
                        </span>
                      ) : null}
                    </div>

                    {open ? (
                      <GiveForm
                        locale={locale}
                        projectId={projectId}
                        finalProjectId={project.id}
                        projectName={project.name}
                        balance={balance}
                        most={most}
                        firstGift={firstGift}
                        step={FINAL_STEP}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
