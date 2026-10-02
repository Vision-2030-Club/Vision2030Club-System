import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Logo } from '@/components/CompanyPicker';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { LogoInput } from '@/components/LogoInput';
import { Badge, Card, Input, Label } from '@/components/ui';
import { localized } from '@/lib/format';
import type { Company } from '@/lib/interviews/types';
import { setCompanyFullAction, setRoomDeletedAction, upsertCompanyAction } from './actions';

/**
 * The companies students choose from (their رغبات), for managers: add one
 * with its logo, edit it, mark it full (it stays on the form, blurred and
 * unclickable, and the submit actions refuse it; fullCompanies.ts), or remove it (a soft hide,
 * restorable, the Rooms tab's own delete). Shown on the Applicants tab.
 */
export async function CompanyManager({
  locale,
  projectId,
  companies,
  fullIds,
}: {
  locale: string;
  projectId: string;
  companies: Company[];
  /** fullCompanyIds(settings): which of them are full. */
  fullIds: Set<string>;
}) {
  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  const id = projectId;
  const visible = companies.filter((c) => !c.is_hidden);
  const removed = companies.filter((c) => c.is_hidden);

  return (
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
            const full = fullIds.has(company.id);
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
        <LogoInput id={`${key}-logo`} />
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
