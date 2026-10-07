import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Logo } from '@/components/CompanyPicker';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { LogoInput } from '@/components/LogoInput';
import { Badge, Card, EmptyState, Input, Label, Textarea } from '@/components/ui';
import { localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { companySheets, sheetKey } from '@/lib/interviews/companySheets';
import { siteUrl } from '@/lib/interviews/email';
import { fullCompanyIds } from '@/lib/interviews/fullCompanies';
import { roomLinks } from '@/lib/interviews/roomLinks';
import {
  loadAcceptedPhones,
  loadCompanies,
  loadCounters,
  loadRooms,
  loadSessions,
  type AcceptedPhone,
} from '@/lib/interviews/queries';
import type { Company, Room } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { CopyField } from '../CopyField';
import {
  acceptPhonesAction,
  createRoomLinkAction,
  rotateCompanyTokenAction,
  setCompanyFullAction,
  setCompanyHiddenAction,
  syncCompanySheetAction,
  unacceptPhoneAction,
  upsertCompanyAction,
} from '../actions';

/**
 * The companies, one card each, made on their own with nothing about rooms:
 * the names and logo students see on the apply form, full or open, and
 * everything that belongs to the company itself — its candidate link (the
 * room flow), the phone numbers HR accepted for it, its interviewer link and
 * PIN, and its Google Sheets. Which rooms it interviews in, and when, is
 * decided later on the Rooms tab; the card lists what has been assigned.
 *
 * Removing a company is a soft hide (setCompanyHiddenAction): off the form
 * and the floor, restorable from the section at the bottom, with its rooms
 * and bookings untouched.
 */
export default async function InterviewsCompaniesPage({
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
  if (role === 'organizer') return <EmptyState>{tCommon('notPermitted')}</EmptyState>;
  const manage = can.manage(role);
  const decide = can.decide(role);

  const db = createInterviewsClient();
  const [companies, counters, rooms, sessions] = await Promise.all([
    loadCompanies(db, edition.id),
    loadCounters(db, edition.id),
    loadRooms(db, edition.id),
    loadSessions(db, edition.id),
  ]);
  const acceptedPhonesByCompany = new Map(
    await Promise.all(
      companies.map(async (c): Promise<[string, AcceptedPhone[]]> => [c.id, await loadAcceptedPhones(db, c.id)]),
    ),
  );

  const visible = companies.filter((c) => !c.is_hidden);
  const removed = companies.filter((c) => c.is_hidden);
  const fullIds = fullCompanyIds(settings);
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  // The rooms a company has been assigned to (Rooms tab); several are fine.
  const roomsFor = (company: Company): Room[] => [
    ...new Map(
      sessions
        .filter((s) => s.company_id === company.id)
        .map((s) => roomById.get(s.room_id))
        .filter((r): r is Room => Boolean(r?.is_active))
        .map((r) => [r.id, r]),
    ).values(),
  ];

  // The company's public candidate link (roomLinks.ts, kept in the edition's
  // settings); a candidate_token from 0005, where that migration ran, as a fallback.
  const links = roomLinks(settings);
  const sheets = companySheets(settings);
  const candidateLinkFor = (company: Company) => {
    const token = links[company.id] ?? company.candidate_token;
    return token ? `${siteUrl()}/${locale}/interviews/room/${token}` : null;
  };
  const interviewerLinkFor = (company: Company) => `${siteUrl()}/${locale}/interviews/c/${company.access_token}`;

  return (
    <div className="space-y-4">
      {manage ? (
        <Disclosure label={t('register.addCompany')}>
          <CompanyForm locale={locale} projectId={id} t={t} submitLabel={tCommon('create')} />
        </Disclosure>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState>{t('register.noCompanies')}</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((company) => {
            const name = localized(company, 'name', locale);
            const full = fullIds.has(company.id);
            const c = counters.get(company.id);
            const companyRooms = roomsFor(company);
            const roomSheets = companyRooms.map((r) => ({ room: r, sheet: sheets[sheetKey(company.id, r.id)] }));
            return (
              <Card key={company.id}>
                <div className="flex flex-wrap items-start gap-3">
                  <Logo company={{ name, logo_url: company.logo_url }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{name}</span>
                      {full ? <Badge tone="warn">{t('register.full')}</Badge> : null}
                    </div>
                    <p className="text-sm text-ink-muted">
                      {companyRooms.length ? (
                        companyRooms.map((r) => r.name).join(' · ')
                      ) : (
                        <>
                          {t('companiesTab.noRoom')}{' '}
                          <Link href={`/projects/${id}/interviews/rooms`} className="text-brand-600 hover:underline">
                            {t('tabs.rooms')}
                          </Link>
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {t('decision.accepted')}: <span className="ltr-nums">{c?.accepted ?? 0}</span> ·{' '}
                      {t('overview.bookedOfSlots')}:{' '}
                      <span className="ltr-nums">
                        {c?.slots_booked ?? 0} / {c?.slots_total ?? 0}
                      </span>
                    </p>
                  </div>
                </div>

                {manage ? (
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <Disclosure label={tCommon('edit')} title={name}>
                      <CompanyForm locale={locale} projectId={id} company={company} t={t} submitLabel={tCommon('save')} />
                    </Disclosure>
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
                    <ConfirmForm
                      action={setCompanyHiddenAction}
                      trigger={t('register.remove')}
                      title={t('register.removeTitle')}
                      body={t('register.removeBody')}
                      confirmLabel={t('register.remove')}
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="project_id" value={id} />
                      <input type="hidden" name="company_id" value={company.id} />
                      <input type="hidden" name="hidden" value="true" />
                    </ConfirmForm>
                  </div>
                ) : null}

                {decide ? (
                  <div className="mt-4 space-y-3 border-t border-line pt-3">
                    {candidateLinkFor(company) ? (
                      <CopyField label={t('companies.candidateLink')} value={candidateLinkFor(company)!} />
                    ) : manage ? (
                      <ActionForm
                        action={createRoomLinkAction}
                        submitLabel={t('companies.createLink')}
                        variant="secondary"
                        className="space-y-2"
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="project_id" value={id} />
                        <input type="hidden" name="company_id" value={company.id} />
                      </ActionForm>
                    ) : null}

                    <Disclosure label={t('companies.acceptedPhones')}>
                      <AcceptedPhones
                        locale={locale}
                        projectId={id}
                        company={company}
                        phones={acceptedPhonesByCompany.get(company.id) ?? []}
                        t={t}
                        tCommon={tCommon}
                      />
                    </Disclosure>

                    {manage ? (
                      <Disclosure label={t('companies.interviewerSide')}>
                        <div className="space-y-3">
                          <CopyField label={t('companies.interviewerLink')} value={interviewerLinkFor(company)} />
                          <p className="text-xs text-ink-muted">
                            {company.access_pin
                              ? t('companies.pinIs', { pin: company.access_pin })
                              : t('companies.noPin')}
                          </p>
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
                      </Disclosure>
                    ) : null}

                    {manage ? (
                      <Disclosure label={t('companies.sheet')}>
                        <div className="space-y-3">
                          <p className="text-xs text-ink-muted">{t('companies.sheetHint')}</p>
                          {roomSheets.length ? (
                            <ul className="space-y-1">
                              {roomSheets.map(({ room: r, sheet }) => (
                                <li key={r.id} className="text-sm">
                                  <span className="font-medium">{r.name}</span>
                                  {' · '}
                                  {sheet ? (
                                    <a
                                      href={sheet.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-medium text-brand-600 hover:underline"
                                    >
                                      {t('companies.sheetOpen')}
                                    </a>
                                  ) : (
                                    <span className="text-ink-muted">{t('companies.sheetNone')}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-ink-muted">{t('companies.sheetNoRooms')}</p>
                          )}
                          {roomSheets.length ? (
                            <ActionForm
                              action={syncCompanySheetAction}
                              submitLabel={roomSheets.every(({ sheet }) => sheet) ? t('companies.sheetSync') : t('companies.sheetCreate')}
                              variant="secondary"
                              className="space-y-2"
                            >
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="project_id" value={id} />
                              <input type="hidden" name="company_id" value={company.id} />
                            </ActionForm>
                          ) : null}
                        </div>
                      </Disclosure>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {manage && removed.length > 0 ? (
        <Disclosure label={t('register.removedSection', { count: removed.length })}>
          <ul className="space-y-2">
            {removed.map((company) => (
              <li key={company.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="text-sm text-ink-muted">{localized(company, 'name', locale)}</span>
                <ActionForm action={setCompanyHiddenAction} submitLabel={t('register.restore')} variant="secondary" className="space-y-0">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="project_id" value={id} />
                  <input type="hidden" name="company_id" value={company.id} />
                  <input type="hidden" name="hidden" value="false" />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'interviews'>>>;
type TCommon = Awaited<ReturnType<typeof getTranslations<'common'>>>;

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


/**
 * Who HR accepted for this room's company, and a box to accept more by phone
 * number (acceptPhonesAction). Starts empty: only numbers HR types are used.
 */
function AcceptedPhones({
  locale,
  projectId,
  company,
  phones,
  t,
  tCommon,
}: {
  locale: string;
  projectId: string;
  company: Company;
  phones: AcceptedPhone[];
  t: T;
  tCommon: TCommon;
}) {
  return (
    <div className="space-y-3">
      {phones.length ? (
        <ul className="space-y-1 text-sm">
          {phones.map((p) => (
            <li key={p.application_id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5">
              <span className="ltr-nums">
                {p.phone}
                {p.name ? ` · ${p.name}` : ''}
              </span>
              <form action={unacceptPhoneAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="company_id" value={company.id} />
                <input type="hidden" name="application_id" value={p.application_id} />
                <button type="submit" className="text-xs text-ink-muted hover:text-danger-600">
                  {tCommon('delete')}
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-muted">{t('companies.noAcceptedPhones')}</p>
      )}

      <ActionForm action={acceptPhonesAction} submitLabel={tCommon('save')}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="company_id" value={company.id} />
        <div>
          <Label htmlFor={`${company.id}-phones`}>{t('companies.addPhones')}</Label>
          <Textarea
            id={`${company.id}-phones`}
            name="phones"
            rows={3}
            placeholder={'05xxxxxxxx\n05xxxxxxxx'}
            dir="ltr"
          />
          <p className="mt-1 text-xs text-ink-muted">{t('companies.addPhonesHint')}</p>
        </div>
      </ActionForm>
    </div>
  );
}
