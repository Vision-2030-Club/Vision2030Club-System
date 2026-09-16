import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { Badge, Card, EmptyState, Input, Label, Textarea } from '@/components/ui';
import { localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { siteUrl } from '@/lib/interviews/email';
import { loadCompanies, loadCounters } from '@/lib/interviews/queries';
import type { Company } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { CopyField } from '../CopyField';
import { rotateCompanyTokenAction, upsertCompanyAction } from '../actions';

export default async function InterviewsCompaniesPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  const db = createInterviewsClient();

  const [companies, counters] = await Promise.all([
    loadCompanies(db, edition.id),
    loadCounters(db, edition.id),
  ]);

  const manage = can.manage(role);
  const linkFor = (company: Company) =>
    `${siteUrl()}/${locale}/interviews/c/${company.access_token}`;

  return (
    <div className="space-y-4">
      {manage ? (
        <Disclosure label={t('companies.new')}>
          <CompanyForm locale={locale} projectId={id} t={t} tCommon={tCommon} />
        </Disclosure>
      ) : null}

      {companies.length === 0 ? (
        <EmptyState>{t('companies.empty')}</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {companies.map((company) => {
            const c = counters.get(company.id);
            return (
              <Card key={company.id}>
                <div className="flex flex-wrap items-start gap-3">
                  {company.logo_url ? (
                    // Company logos are external URLs the club pasted in;
                    // next/image would need every host allow-listed.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={company.logo_url}
                      alt=""
                      width={48}
                      height={48}
                      className="size-12 shrink-0 rounded-lg border border-line bg-white object-contain p-1"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{localized(company, 'name', locale)}</span>
                      {company.is_hidden ? <Badge>{t('companies.hidden')}</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {t('decision.accepted')}: <span className="ltr-nums">{c?.accepted ?? 0}</span> ·{' '}
                      {t('decision.pending')}: <span className="ltr-nums">{c?.pending ?? 0}</span> ·{' '}
                      {t('overview.bookedOfSlots')}:{' '}
                      <span className="ltr-nums">
                        {c?.slots_booked ?? 0} / {c?.slots_total ?? 0}
                      </span>
                    </p>
                  </div>
                </div>

                {manage ? (
                  <div className="mt-4 space-y-3 border-t border-line pt-3">
                    <CopyField label={t('companies.interviewerLink')} value={linkFor(company)} />
                    <p className="text-xs text-ink-muted">
                      {company.access_pin
                        ? t('companies.pinIs', { pin: company.access_pin })
                        : t('companies.noPin')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Disclosure label={tCommon('edit')} title={localized(company, 'name', locale)}>
                        <CompanyForm
                          locale={locale}
                          projectId={id}
                          company={company}
                          t={t}
                          tCommon={tCommon}
                        />
                      </Disclosure>
                      <ConfirmForm
                        action={rotateCompanyTokenAction}
                        trigger={t('companies.rotate')}
                        title={t('companies.rotateTitle')}
                        body={t('companies.rotateBody')}
                        confirmLabel={t('companies.rotate')}
                        variant="secondary"
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="project_id" value={id} />
                        <input type="hidden" name="company_id" value={company.id} />
                      </ConfirmForm>
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'interviews'>>>;
type TCommon = Awaited<ReturnType<typeof getTranslations<'common'>>>;

/** One form for both creating and editing; `company` decides which. */
function CompanyForm({
  locale,
  projectId,
  company,
  t,
  tCommon,
}: {
  locale: string;
  projectId: string;
  company?: Company;
  t: T;
  tCommon: TCommon;
}) {
  const prefix = company?.id ?? 'new';
  return (
    <ActionForm action={upsertCompanyAction} submitLabel={company ? tCommon('save') : tCommon('create')}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="project_id" value={projectId} />
      {company ? <input type="hidden" name="company_id" value={company.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${prefix}-name_en`}>{t('companies.nameEn')}</Label>
          <Input id={`${prefix}-name_en`} name="name_en" defaultValue={company?.name_en} required />
        </div>
        <div>
          <Label htmlFor={`${prefix}-name_ar`}>{t('companies.nameAr')}</Label>
          <Input id={`${prefix}-name_ar`} name="name_ar" defaultValue={company?.name_ar} required />
        </div>
      </div>
      <div>
        <Label htmlFor={`${prefix}-logo_url`}>{t('companies.logoUrl')}</Label>
        <Input id={`${prefix}-logo_url`} name="logo_url" type="url" dir="ltr" defaultValue={company?.logo_url ?? ''} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${prefix}-desc_en`}>{t('companies.descEn')}</Label>
          <Textarea id={`${prefix}-desc_en`} name="desc_en" rows={3} defaultValue={company?.desc_en ?? ''} />
        </div>
        <div>
          <Label htmlFor={`${prefix}-desc_ar`}>{t('companies.descAr')}</Label>
          <Textarea id={`${prefix}-desc_ar`} name="desc_ar" rows={3} defaultValue={company?.desc_ar ?? ''} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${prefix}-sort_order`}>{t('companies.sortOrder')}</Label>
          <Input id={`${prefix}-sort_order`} name="sort_order" type="number" defaultValue={company?.sort_order ?? 100} />
        </div>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_hidden" defaultChecked={company?.is_hidden ?? false} className="accent-brand-600" />
          {t('companies.hideFromForm')}
        </label>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t('companies.pin')}</legend>
        <p className="mb-2 text-xs text-ink-muted">{t('companies.pinHint')}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {company ? (
            <label className="flex items-center gap-2">
              <input type="radio" name="pin_choice" value="keep" defaultChecked className="accent-brand-600" />
              {t('companies.pinKeep')}
            </label>
          ) : null}
          <label className="flex items-center gap-2">
            <input type="radio" name="pin_choice" value="none" defaultChecked={!company} className="accent-brand-600" />
            {t('companies.pinNone')}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="pin_choice" value="new" className="accent-brand-600" />
            {t('companies.pinNew')}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="pin_choice" value="typed" className="accent-brand-600" />
            {t('companies.pinTyped')}
          </label>
          <Input name="access_pin" dir="ltr" inputMode="numeric" pattern="[0-9]{4,8}" placeholder="1234" className="max-w-32" aria-label={t('companies.pin')} />
        </div>
      </fieldset>
    </ActionForm>
  );
}
