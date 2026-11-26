import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { StatTile } from '@/components/charts/BarList';
import { Medal } from '@/components/QurooshMedal';
import { Alert, Badge, Card, cx, EmptyState, Input, Label, PageHeader, Textarea } from '@/components/ui';
import { localized } from '@/lib/format';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { FINAL_STATUSES, FINAL_STEP, getFinalProjectsAdmin, getFinalStatus } from '@/lib/quroosh/final';
import { formatQuroosh } from '@/lib/quroosh/wallet';
import { isQurooshConfigured } from '@/lib/supabase/quroosh';
import { GuestStartQr } from '../GuestStartQr';
import { hideFinalProjectAction, saveFinalProjectAction, saveFinalStatusAction } from './actions';

/**
 * The Final Wave (الحفل الختامي, Quroosh 0014), for the project's managers
 * only: whether guests see it and may give, the projects on stage (a name and
 * a brief each; add, rewrite, hide), and what each collected, with the top
 * ten as guests see them.
 */
export default async function QurooshFinalAdminPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getQurooshAccess(id);
  if (!access || !can.manage(access.role)) notFound();

  const t = await getTranslations('quroosh');
  const header = <PageHeader title={t('final.title')} description={localized(access.project, 'name', locale)} />;
  if (!isQurooshConfigured()) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('applications.notConfigured')}</Alert>
      </>
    );
  }

  const [status, projects] = await Promise.all([getFinalStatus(id), getFinalProjectsAdmin(id)]);
  // Before 0014 is applied the functions do not exist: say so, do not crash.
  if (status === null || projects === null) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('final.notReady')}</Alert>
      </>
    );
  }

  const shown = projects.filter((project) => !project.hidden);
  const total = projects.reduce((sum, project) => sum + project.received, 0);
  const gifts = projects.reduce((sum, project) => sum + project.gifts, 0);
  // The ceremony's leaderboard as guests see it: shown projects that collected something.
  const ranked = [...shown].filter((project) => project.received > 0).sort((a, b) => b.received - a.received);
  const top = ranked.slice(0, 10).map((project) => ({
    ...project,
    place: ranked.findIndex((other) => other.received === project.received) + 1,
  }));
  const hidden = { project_id: id, locale };

  return (
    <div className="space-y-6">
      {header}
      <p className="text-sm text-ink-muted">{t('final.intro', { step: formatQuroosh(FINAL_STEP) })}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label={t('final.statProjects')} value={formatQuroosh(shown.length)} />
        <StatTile label={t('final.statGiven')} value={formatQuroosh(total)} />
        <StatTile label={t('final.statGifts')} value={formatQuroosh(gifts)} />
      </div>

      {/* Where guests come in: sign up or sign in, then this tab (0017). */}
      <GuestStartQr projectId={id} locale={locale} />

      {/* Who sees it, and whether they may give. */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-ink">{t('final.statusTitle')}</h2>
          <Badge tone={status === 'open' ? 'ok' : status === 'closed' ? 'warn' : 'neutral'}>
            {t(`final.status.${status}.label`)}
          </Badge>
        </div>
        <ActionForm action={saveFinalStatusAction} submitLabel={t('final.saveStatus')}>
          <Hidden values={hidden} />
          <fieldset className="grid gap-2 sm:grid-cols-3">
            <legend className="sr-only">{t('final.statusTitle')}</legend>
            {FINAL_STATUSES.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer gap-3 rounded-xl border-2 border-line p-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
              >
                <input
                  type="radio"
                  name="status"
                  value={option}
                  defaultChecked={option === status}
                  className="mt-1 accent-brand-600"
                />
                <span>
                  <span className="block font-medium text-ink">{t(`final.status.${option}.label`)}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{t(`final.status.${option}.hint`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </ActionForm>
      </Card>

      {/* The top ten, as guests see it. */}
      <section className="space-y-3">
        <h2 className="font-semibold text-ink">{t('final.boardTitle')}</h2>
        {top.length === 0 ? (
          <EmptyState>{t('final.boardEmpty')}</EmptyState>
        ) : (
          <ol className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
            {top.map((project) => (
              <li key={project.id} className="flex items-center gap-3 p-3">
                {project.place <= 3 ? (
                  <Medal place={project.place} />
                ) : (
                  <span className="ltr-nums w-9 shrink-0 text-center text-sm font-bold tabular-nums text-ink-muted">
                    {project.place}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  <bdi>{project.name}</bdi>
                </span>
                <span className="text-xs text-ink-muted">{t('final.givers', { count: project.givers })}</span>
                <span className="ltr-nums font-semibold tabular-nums text-ink" dir="ltr">
                  {formatQuroosh(project.received)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* The projects on stage, in the order guests see them. */}
      <section className="space-y-3">
        <h2 className="font-semibold text-ink">{t('final.projectsTitle')}</h2>
        {projects.length === 0 ? (
          <EmptyState>{t('final.projectsEmpty')}</EmptyState>
        ) : (
          <ul className="space-y-3">
            {projects.map((project, index) => (
              <li key={project.id}>
                <Card className={cx('space-y-3', project.hidden && 'opacity-70')}>
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    {/* `ltr-nums` on the number alone: its inline-block would undo the square's grid. */}
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-950 text-sm font-bold text-accent-2">
                      <span className="ltr-nums tabular-nums">{index + 1}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">
                          <bdi>{project.name}</bdi>
                        </span>
                        {project.hidden ? <Badge tone="neutral">{t('final.hidden')}</Badge> : null}
                      </div>
                      {project.brief ? (
                        <p dir="auto" className="mt-1 text-sm whitespace-pre-line text-ink-muted">
                          {project.brief}
                        </p>
                      ) : null}
                    </div>
                    <span className="ltr-nums text-lg font-bold tabular-nums text-ink" dir="ltr">
                      {formatQuroosh(project.received)}
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted">
                    {t('final.gifts', { count: project.gifts })} · {t('final.givers', { count: project.givers })}
                  </p>

                  <details className="group rounded-lg border border-line">
                    <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-brand-700 hover:bg-surface-muted">
                      {t('final.edit')}
                    </summary>
                    <div className="border-t border-line p-3">
                      <ActionForm action={saveFinalProjectAction} submitLabel={t('final.save')}>
                        <Hidden values={{ ...hidden, final_project_id: project.id }} />
                        <ProjectFields prefix={project.id} name={project.name} brief={project.brief} />
                      </ActionForm>
                    </div>
                  </details>

                  <ActionForm
                    action={hideFinalProjectAction}
                    submitLabel={project.hidden ? t('final.show') : t('final.hide')}
                    variant="secondary"
                  >
                    <Hidden
                      values={{ ...hidden, final_project_id: project.id, hidden: project.hidden ? 'false' : 'true' }}
                    />
                  </ActionForm>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="space-y-4">
        <h2 className="font-semibold text-ink">{t('final.newTitle')}</h2>
        <ActionForm action={saveFinalProjectAction} submitLabel={t('final.add')}>
          <Hidden values={hidden} />
          <ProjectFields prefix="new" />
        </ActionForm>
      </Card>
    </div>
  );
}

function Hidden({ values }: { values: Record<string, string> }) {
  return (
    <>
      {Object.entries(values).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

async function ProjectFields({ prefix, name, brief }: { prefix: string; name?: string; brief?: string | null }) {
  const t = await getTranslations('quroosh.final');
  return (
    <>
      <div>
        <Label htmlFor={`${prefix}-name`}>{t('name')}</Label>
        <Input id={`${prefix}-name`} name="name" dir="auto" defaultValue={name} maxLength={120} required />
      </div>
      <div>
        <Label htmlFor={`${prefix}-brief`}>{t('brief')}</Label>
        <Textarea id={`${prefix}-brief`} name="brief" dir="auto" defaultValue={brief ?? ''} maxLength={1000} rows={4} />
        <p className="mt-1 text-xs text-ink-muted">{t('briefHint')}</p>
      </div>
    </>
  );
}
