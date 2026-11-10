import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Alert, Badge, Card, EmptyState, Input, Label, PageHeader } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { formatDateTime, localized } from '@/lib/format';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import {
  answerOf,
  asLocale,
  isEmptyAnswer,
  optionLabel,
  questionLabel,
  yesNoValue,
  type FormQuestion,
} from '@/lib/quroosh/form';
import { loadForm, requestCatalog } from '@/lib/quroosh/loadForm';
import { siteUrl } from '@/lib/site';
import type { QurooshApplication } from '@/lib/quroosh/types';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { savePrivacyUrlAction, setApplicationsOpenAction, syncApplicationSheetAction } from './actions';

type Application = QurooshApplication;

/**
 * Quroosh's applications, for the project's managers only: they hold
 * founders' phones, emails and ages. The form is opened and closed here, and
 * its public address shown to share, and its questions edited (the
 * Questions page beside this one, Quroosh 0004). Each application unfolds to
 * every answer, in the form's order and in its current wording: answers are
 * stored by question and choice, so an edited question reads the new way on
 * every past application. A hidden question still shows where it was
 * answered.
 *
 * The club database says who manages the project (getQurooshAccess); the
 * applications themselves are in the Quroosh database (supabase/quroosh),
 * read with its secret key only after that answer.
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
  if (!isQurooshConfigured()) {
    return (
      <>
        <PageHeader title={t('applications.title')} description={localized(access.project, 'name', locale)} />
        <Alert tone="warn">{t('applications.notConfigured')}</Alert>
      </>
    );
  }
  const quroosh = createQurooshClient();
  const [{ data: settings }, { data: rows }, { data: sheet }, { form }, catalog] = await Promise.all([
    quroosh.from('settings').select('applications_open, privacy_url').eq('project_id', id).maybeSingle(),
    quroosh
      .from('applications')
      .select('*, application_members(name, phone, email, sort_order)')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    // Its own read: before Quroosh 0003 the column is missing, and the page
    // must still load (it then shows no sheet).
    quroosh.from('settings').select('sheet_url').eq('project_id', id).maybeSingle(),
    loadForm(quroosh, id),
    requestCatalog(locale),
  ]);
  const lang = asLocale(locale);
  const sheetUrl = (sheet as { sheet_url: string | null } | null)?.sheet_url ?? null;
  const open = settings?.applications_open ?? false;
  const applications = (rows ?? []) as Application[];
  const publicUrl = `${siteUrl()}/${locale}/quroosh/apply/${id}`;

  const answer = (question: FormQuestion, row: Application) => {
    const value = answerOf(question, row);
    if (isEmptyAnswer(value)) return <span className="text-ink-muted">—</span>;
    if (question.kind === 'yesno') return optionLabel(question, yesNoValue(value), lang, catalog);
    if (question.kind === 'consent') return value ? t('applications.yes') : t('applications.no');
    if (question.kind === 'checkboxes' && Array.isArray(value)) {
      return value.map((v) => optionLabel(question, String(v), lang, catalog)).join(locale === 'ar' ? '، ' : ', ');
    }
    if (question.kind === 'radio' || question.kind === 'select') {
      return optionLabel(question, String(value), lang, catalog);
    }
    if (question.kind === 'tel' || question.kind === 'email' || question.kind === 'url' || question.kind === 'number') {
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

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{t('questions.title')}</p>
          <p className="mt-1 text-xs text-ink-muted">{t('questions.cardHint')}</p>
        </div>
        <Link
          href={`/projects/${id}/quroosh/applications/questions`}
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t('questions.edit')}
        </Link>
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="text-sm font-medium text-ink">{t('applications.sheet')}</p>
          {sheetUrl ? (
            <p className="mt-1 break-all text-sm" dir="ltr">
              <a href={sheetUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                {sheetUrl}
              </a>
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">{t('applications.sheetNone')}</p>
          )}
          <p className="mt-1 text-xs text-ink-muted">{t('applications.sheetHint')}</p>
        </div>
        <ActionForm action={syncApplicationSheetAction} submitLabel={t('applications.sheetSync')} variant="secondary">
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="locale" value={locale} />
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
                <span className="font-semibold text-ink">{row.venture_name ?? row.founder_name}</span>
                <span className="text-sm text-ink-muted">{row.founder_name}</span>
                <span className="ltr-nums text-sm text-ink-muted" dir="ltr">
                  {row.phone}
                </span>
                <span className="ms-auto text-xs text-ink-muted">{formatDateTime(row.created_at, locale)}</span>
              </summary>
              <dl className="grid gap-x-6 gap-y-3 border-t border-line p-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
                {form
                  .filter((question) => !question.hidden || !isEmptyAnswer(answerOf(question, row)))
                  .map((question) => (
                  <div key={question.key} className="contents">
                    <dt className="text-sm font-medium text-ink-muted">{questionLabel(question, lang, catalog)}</dt>
                    <dd className="text-sm text-ink">
                      {answer(question, row)}
                      {question.key === 'has_team' && row.application_members.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {[...row.application_members]
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
