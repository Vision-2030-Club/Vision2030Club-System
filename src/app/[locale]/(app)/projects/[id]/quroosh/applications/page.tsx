import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, EmptyState, Input, Label, PageHeader } from '@/components/ui';
import { formatDateTime, localized } from '@/lib/format';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { QUESTIONS, type Question } from '@/lib/quroosh/questions';
import { siteUrl } from '@/lib/site';
import type { QurooshApplication } from '@/lib/quroosh/types';
import { createClient } from '@/lib/supabase/server';
import { savePrivacyUrlAction, setApplicationsOpenAction } from './actions';

type Application = QurooshApplication;

/**
 * Quroosh's applications (0075), for the project's managers only: they hold
 * founders' phones, emails and ages. The form is opened and closed here, and
 * its public address shown to share. Each application unfolds to every
 * answer, in the form's own order.
 */
export default async function QurooshApplicationsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getQurooshAccess(id);
  if (!access || !can.manage(access.role)) notFound();

  const t = await getTranslations('quroosh');
  const supabase = await createClient();
  const [{ data: settings }, { data: rows }] = await Promise.all([
    supabase.from('quroosh_settings').select('applications_open, privacy_url').eq('project_id', id).maybeSingle(),
    supabase
      .from('quroosh_applications')
      .select('*, quroosh_application_members(name, phone, email, sort_order)')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
  ]);
  const open = settings?.applications_open ?? false;
  const applications = (rows ?? []) as Application[];
  const publicUrl = `${siteUrl()}/${locale}/quroosh/apply/${id}`;

  const answer = (question: Question, row: Application) => {
    const value = row[question.name];
    if (value === null || value === undefined || value === '') return <span className="text-ink-muted">—</span>;
    if (question.kind === 'yesno' || question.kind === 'consent') {
      return question.kind === 'yesno'
        ? t(`apply.options.${question.name}.${value ? 'yes' : 'no'}`)
        : value
          ? t('applications.yes')
          : t('applications.no');
    }
    if (question.kind === 'checkboxes' && Array.isArray(value)) {
      return value.map((v) => t(`apply.options.${question.name}.${v}`)).join(locale === 'ar' ? '، ' : ', ');
    }
    if (question.kind === 'radio' || question.kind === 'select') {
      return t(`apply.options.${question.name}.${String(value)}`);
    }
    if (question.kind === 'tel' || question.kind === 'email' || question.kind === 'url') {
      return (
        <span dir="ltr" className="ltr-nums">
          {String(value)}
        </span>
      );
    }
    return <span className="whitespace-pre-line">{String(value)}</span>;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('applications.title')}
        description={localized(access.project, 'name', locale)}
        action={<Badge tone={open ? 'ok' : 'neutral'}>{open ? t('applications.open') : t('applications.closed')}</Badge>}
      />

      <Card className="space-y-4">
        <div>
          <p className="text-sm font-medium text-ink">{t('applications.link')}</p>
          <p className="mt-1 break-all text-sm" dir="ltr">
            <a href={publicUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">
              {publicUrl}
            </a>
          </p>
          <p className="mt-1 text-xs text-ink-muted">{t('applications.linkHint')}</p>
        </div>

        <ActionForm
          action={setApplicationsOpenAction}
          submitLabel={open ? t('applications.closeAction') : t('applications.openAction')}
          variant={open ? 'secondary' : 'primary'}
        >
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="open" value={open ? 'false' : 'true'} />
        </ActionForm>

        <ActionForm action={savePrivacyUrlAction} submitLabel={t('applications.save')} variant="secondary">
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="locale" value={locale} />
          <div>
            <Label htmlFor="privacy-url">{t('applications.privacyUrl')}</Label>
            <Input
              id="privacy-url"
              name="privacy_url"
              type="url"
              dir="ltr"
              defaultValue={settings?.privacy_url ?? ''}
              placeholder="https://"
            />
            <p className="mt-1 text-xs text-ink-muted">{t('applications.privacyHint')}</p>
          </div>
        </ActionForm>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">
          {t('applications.count', { count: applications.length })}
        </h2>
        {applications.length === 0 ? (
          <EmptyState>{t('applications.empty')}</EmptyState>
        ) : (
          applications.map((row) => (
            <details key={row.id} className="rounded-xl border border-line bg-surface shadow-sm">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 p-4">
                <span className="font-semibold text-ink">{row.venture_name}</span>
                <span className="text-sm text-ink-muted">{row.founder_name}</span>
                <span className="ltr-nums text-sm text-ink-muted" dir="ltr">
                  {row.phone}
                </span>
                <span className="ms-auto text-xs text-ink-muted">{formatDateTime(row.created_at, locale)}</span>
              </summary>
              <dl className="grid gap-x-6 gap-y-3 border-t border-line p-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
                {QUESTIONS.map((question) => (
                  <div key={question.name} className="contents">
                    <dt className="text-sm font-medium text-ink-muted">{t(`apply.q.${question.name}`)}</dt>
                    <dd className="text-sm text-ink">
                      {answer(question, row)}
                      {question.name === 'has_team' && row.quroosh_application_members.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {[...row.quroosh_application_members]
                            .sort((a, b) => a.sort_order - b.sort_order)
                            .map((member) => (
                              <li key={`${member.phone}-${member.sort_order}`}>
                                {member.name} ·{' '}
                                <span dir="ltr" className="ltr-nums">
                                  {member.phone}
                                </span>{' '}
                                ·{' '}
                                <span dir="ltr" className="ltr-nums">
                                  {member.email}
                                </span>
                              </li>
                            ))}
                        </ul>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          ))
        )}
      </div>
    </div>
  );
}
