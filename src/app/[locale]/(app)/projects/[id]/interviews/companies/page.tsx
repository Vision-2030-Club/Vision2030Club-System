import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { Badge, Card, EmptyState, Input, Label, Textarea } from '@/components/ui';
import { localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { siteUrl } from '@/lib/interviews/email';
import { loadAcceptedPhones, loadCompanies, loadCounters, type AcceptedPhone } from '@/lib/interviews/queries';
import type { Company } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';
import { CopyField } from '../CopyField';
import {
  acceptPhonesAction,
  createRoomAction,
  renameRoomAction,
  setRoomDeletedAction,
  unacceptPhoneAction,
} from '../actions';

/**
 * One room per card: a booth a candidate books into, with its own link.
 * "Room" here is a company + a physical room created together by
 * createRoomAction (0005) — the interviewer-facing side of a company
 * (access_token, PIN, the multi-company apply form) is a different,
 * unrelated feature this project does not use, so none of it is shown here.
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
  const { edition, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  const db = createInterviewsClient();

  const [companies, counters] = await Promise.all([
    loadCompanies(db, edition.id),
    loadCounters(db, edition.id),
  ]);
  const acceptedPhonesByCompany = new Map(
    await Promise.all(
      companies.map(async (c): Promise<[string, AcceptedPhone[]]> => [c.id, await loadAcceptedPhones(db, c.id)]),
    ),
  );

  const manage = can.manage(role);
  const decide = can.decide(role);
  const candidateLinkFor = (company: Company) =>
    company.candidate_token ? `${siteUrl()}/${locale}/interviews/room/${company.candidate_token}` : null;

  return (
    <div className="space-y-4">
      {manage ? (
        <Disclosure label={t('companies.addRoom')}>
          <ActionForm action={createRoomAction} submitLabel={tCommon('create')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="project_id" value={id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="new-room-name">{t('companies.roomName')}</Label>
                <Input id="new-room-name" name="name" required />
              </div>
              <div>
                <Label htmlFor="new-room-logo">{t('companies.logoUrl')}</Label>
                <Input id="new-room-logo" name="logo_url" type="url" dir="ltr" />
              </div>
              <div>
                <Label htmlFor="new-room-day">{t('companies.roomDay')}</Label>
                <Input id="new-room-day" name="day" type="date" dir="ltr" defaultValue={toDateInput(new Date())} required />
              </div>
            </div>
            <p className="text-xs text-ink-muted">{t('companies.addRoomHint')}</p>
          </ActionForm>
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
                    // Logos are external URLs pasted in; next/image would
                    // need every host allow-listed.
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
                      {company.is_hidden ? <Badge tone="danger">{t('companies.deleted')}</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {t('decision.accepted')}: <span className="ltr-nums">{c?.accepted ?? 0}</span> ·{' '}
                      {t('overview.bookedOfSlots')}:{' '}
                      <span className="ltr-nums">
                        {c?.slots_booked ?? 0} / {c?.slots_total ?? 0}
                      </span>
                    </p>
                  </div>
                </div>

                {decide && candidateLinkFor(company) ? (
                  <div className="mt-4 space-y-3 border-t border-line pt-3">
                    <CopyField label={t('companies.candidateLink')} value={candidateLinkFor(company)!} />

                    {manage ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Disclosure label={tCommon('edit')} title={localized(company, 'name', locale)}>
                          <RoomForm locale={locale} projectId={id} company={company} t={t} tCommon={tCommon} />
                        </Disclosure>
                        {company.is_hidden ? (
                          <ActionForm
                            action={setRoomDeletedAction}
                            submitLabel={t('companies.restore')}
                            variant="secondary"
                            className="space-y-0"
                          >
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="project_id" value={id} />
                            <input type="hidden" name="company_id" value={company.id} />
                            <input type="hidden" name="deleted" value="false" />
                          </ActionForm>
                        ) : (
                          <ConfirmForm
                            action={setRoomDeletedAction}
                            trigger={t('companies.delete')}
                            title={t('companies.deleteTitle')}
                            body={t('companies.deleteBody')}
                            confirmLabel={t('companies.delete')}
                          >
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="project_id" value={id} />
                            <input type="hidden" name="company_id" value={company.id} />
                            <input type="hidden" name="deleted" value="true" />
                          </ConfirmForm>
                        )}
                      </div>
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

/** Renames a room and its logo — the company and physical room stay in sync. */
function RoomForm({
  locale,
  projectId,
  company,
  t,
  tCommon,
}: {
  locale: string;
  projectId: string;
  company: Company;
  t: T;
  tCommon: TCommon;
}) {
  return (
    <ActionForm action={renameRoomAction} submitLabel={tCommon('save')}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="company_id" value={company.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${company.id}-name`}>{t('companies.roomName')}</Label>
          <Input id={`${company.id}-name`} name="name" defaultValue={company.name_en} required />
        </div>
        <div>
          <Label htmlFor={`${company.id}-logo_url`}>{t('companies.logoUrl')}</Label>
          <Input
            id={`${company.id}-logo_url`}
            name="logo_url"
            type="url"
            dir="ltr"
            defaultValue={company.logo_url ?? ''}
          />
        </div>
      </div>
    </ActionForm>
  );
}

/**
 * HR's pre-approval list for one room's candidate link (0005): phone numbers
 * pasted in ahead of time are what "already chosen by HR" checks against when
 * someone visits the link and identifies themselves.
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
            <li key={p.phone} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5">
              <span className="ltr-nums">
                {p.phone}
                {p.name ? ` · ${p.name}` : ''}
              </span>
              <form action={unacceptPhoneAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="company_id" value={company.id} />
                <input type="hidden" name="phone" value={p.phone} />
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
