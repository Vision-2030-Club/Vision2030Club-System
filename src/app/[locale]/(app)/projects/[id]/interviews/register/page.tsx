import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Logo } from '@/components/CompanyPicker';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { Badge, Card, EmptyState, Input, Label } from '@/components/ui';
import { localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { siteUrl } from '@/lib/interviews/email';
import { loadCompanies } from '@/lib/interviews/queries';
import type { Company } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { CopyField } from '../CopyField';
import { setCompanyFullAction, setRoomDeletedAction, upsertCompanyAction } from '../actions';
import { RegisterForm } from './RegisterForm';

/**
 * Registering a student by hand — a walk-in at the stand, someone who could
 * not use the public form — and, for managers, the companies the form offers.
 *
 * The form is the apply form's short version (name, email, phone, companies,
 * CV) through the same submit_application, so every rule holds: the limit on
 * companies, one application per email, and full companies (0010), which stay
 * on the grid, blurred, and cannot be chosen.
 */
export default async function InterviewsRegisterPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition || !access.settings) notFound();
  const { edition, settings, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');

  if (!can.decide(role)) {
    return <EmptyState>{tCommon('notPermitted')}</EmptyState>;
  }

  const companies = await loadCompanies(createInterviewsClient(), edition.id);
  const visible = companies.filter((c) => !c.is_hidden);
  const removed = companies.filter((c) => c.is_hidden);
  const manage = can.manage(role);
  const archived = edition.status === 'archived';

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <h2 className="mb-1 font-semibold">{t('register.title')}</h2>
        <p className="mb-4 text-xs text-ink-muted">{t('register.intro')}</p>
        {archived ? (
          <EmptyState>{t('errors.archived')}</EmptyState>
        ) : (
          <RegisterForm
            locale={locale}
            projectId={id}
            maxPreferences={settings.max_preferences}
            companies={visible.map((c) => ({
              id: c.id,
              name: localized(c, 'name', locale),
              logo_url: c.logo_url,
              is_full: Boolean(c.is_full),
            }))}
          />
        )}
      </Card>

      <div className="space-y-4">
        <Card>
          <h2 className="mb-1 font-semibold">{t('register.publicForm')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('register.publicFormHint')}</p>
          <CopyField label={t('register.publicLink')} value={`${siteUrl()}/${locale}/interviews/apply/${edition.public_slug}`} />
        </Card>

        {manage ? (
          <Card>
            <h2 className="mb-1 font-semibold">{t('register.manage')}</h2>
            <p className="mb-3 text-xs text-ink-muted">{t('register.manageHint')}</p>

            <Disclosure label={t('register.addCompany')}>
              <CompanyForm locale={locale} projectId={id} t={t} submitLabel={tCommon('create')} />
            </Disclosure>

            {visible.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">{t('register.noCompanies')}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {visible.map((company) => {
                  const name = localized(company, 'name', locale);
                  const full = Boolean(company.is_full);
                  return (
                    <li key={company.id} className="rounded-lg border border-line p-3">
                      <div className="flex items-center gap-3">
                        <Logo company={{ name, logo_url: company.logo_url }} />
                        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                        {full ? <Badge tone="warn">{t('register.full')}</Badge> : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-start gap-2">
                        <ActionForm
                          action={setCompanyFullAction}
                          submitLabel={full ? t('register.markOpen') : t('register.markFull')}
                          variant="secondary"
                          className="space-y-2"
                        >
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="project_id" value={id} />
                          <input type="hidden" name="company_id" value={company.id} />
                          <input type="hidden" name="full" value={full ? 'false' : 'true'} />
                        </ActionForm>
                        <Disclosure label={tCommon('edit')} title={name}>
                          <CompanyForm
                            locale={locale}
                            projectId={id}
                            company={company}
                            t={t}
                            submitLabel={tCommon('save')}
                          />
                        </Disclosure>
                        <ConfirmForm
                          action={setRoomDeletedAction}
                          trigger={t('register.remove')}
                          title={t('register.removeTitle')}
                          body={t('register.removeBody')}
                          confirmLabel={t('register.remove')}
                        >
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="project_id" value={id} />
                          <input type="hidden" name="company_id" value={company.id} />
                          <input type="hidden" name="deleted" value="true" />
                        </ConfirmForm>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {removed.length > 0 ? (
              <div className="mt-3">
                <Disclosure label={t('register.removedSection', { count: removed.length })}>
                  <ul className="space-y-2">
                    {removed.map((company) => (
                      <li
                        key={company.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                      >
                        <span className="text-sm text-ink-muted">{localized(company, 'name', locale)}</span>
                        <ActionForm
                          action={setRoomDeletedAction}
                          submitLabel={t('register.restore')}
                          variant="secondary"
                          className="space-y-0"
                        >
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="project_id" value={id} />
                          <input type="hidden" name="company_id" value={company.id} />
                          <input type="hidden" name="deleted" value="false" />
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'interviews'>>>;

/** Add (no company) or edit one: both names and the logo. */
function CompanyForm({
  locale,
  projectId,
  company,
  t,
  submitLabel,
}: {
  locale: string;
  projectId: string;
  company?: Company;
  t: T;
  submitLabel: string;
}) {
  const key = company?.id ?? 'new';
  return (
    <ActionForm action={upsertCompanyAction} submitLabel={submitLabel}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="project_id" value={projectId} />
      {company ? <input type="hidden" name="company_id" value={company.id} /> : null}
      <div>
        <Label htmlFor={`${key}-name_en`}>{t('companies.nameEn')}</Label>
        <Input id={`${key}-name_en`} name="name_en" dir="ltr" defaultValue={company?.name_en} required />
      </div>
      <div>
        <Label htmlFor={`${key}-name_ar`}>{t('companies.nameAr')}</Label>
        <Input id={`${key}-name_ar`} name="name_ar" dir="rtl" defaultValue={company?.name_ar} />
      </div>
      <div>
        <Label htmlFor={`${key}-logo`}>{t('register.logo')}</Label>
        <Input id={`${key}-logo`} name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
        <p className="mt-1 text-xs text-ink-muted">{t('register.logoHint')}</p>
      </div>
      {company?.logo_url ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="remove_logo" className="accent-brand-600" />
          {t('register.removeLogo')}
        </label>
      ) : null}
    </ActionForm>
  );
}
