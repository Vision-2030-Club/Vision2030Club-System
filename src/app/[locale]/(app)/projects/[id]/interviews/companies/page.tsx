import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { Card, EmptyState, Input, Label, Select, Textarea } from '@/components/ui';
import { localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { companySheets } from '@/lib/interviews/companySheets';
import { siteUrl } from '@/lib/interviews/email';
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
import { toDateInput } from '@/lib/time';
import { CopyField } from '../CopyField';
import {
  acceptPhonesAction,
  createRoomAction,
  createRoomLinkAction,
  renameRoomAction,
  rotateCompanyTokenAction,
  setRoomDeletedAction,
  syncCompanySheetAction,
  unacceptPhoneAction,
} from '../actions';

/**
 * One room per card: a booth a candidate books into, with its own link.
 * "Room" here is a company + a physical room created together by
 * createRoomAction (0005) — but named separately: the room is its booth
 * label ("Room 1", shown as the card's heading), the company is whoever is
 * sitting in it that day ("KPMG", shown underneath and in the floor sheet's
 * own Company column). Each card also keeps the company's INTERVIEWER side
 * — the secret link and PIN the company's HR opens to select applicants and
 * follow their day — behind a disclosure, so the apply-form flow the club
 * decided on in September stays manageable next to the room flow. Which of
 * the two the club runs on the day is an open decision (HANDOFF.md); the
 * page supports both until it is taken.
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
  // Deleted (setRoomDeletedAction) rooms drop off this list entirely rather
  // than showing a "Deleted" badge in it — restoring one is a click away in
  // the section below, but the everyday view stays just the live rooms.
  const activeCompanies = companies.filter((c) => !c.is_hidden);
  const deletedCompanies = companies.filter((c) => c.is_hidden);

  // The room (booth label, e.g. "Room 1") and the company sitting in it
  // (e.g. "KPMG") are separate names now — found through the session that
  // links them, the same lookup renameRoomAction and setRoomDeletedAction use.
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const roomIdByCompany = new Map(sessions.map((s) => [s.company_id, s.room_id]));
  const roomFor = (company: Company): Room | undefined => {
    const roomId = roomIdByCompany.get(company.id);
    return roomId ? roomById.get(roomId) : undefined;
  };

  const manage = can.manage(role);
  const decide = can.decide(role);
  // Each room's public link (roomLinks.ts, kept in the edition's settings);
  // a candidate_token from 0005, where that migration ran, as a fallback.
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
                <Label htmlFor="new-room-company-id">{t('companies.roomCompany')}</Label>
                <Select id="new-room-company-id" name="company_id" defaultValue="">
                  <option value="">{t('companies.roomCompanyNew')}</option>
                  {activeCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {localized(c, 'name', locale)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="new-room-company">{t('companies.companyName')}</Label>
                <Input id="new-room-company" name="company_name" placeholder={t('companies.companyNameHint')} />
              </div>
              <div>
                <Label htmlFor="new-room-company-ar">{t('companies.companyNameAr')}</Label>
                <Input id="new-room-company-ar" name="company_name_ar" dir="rtl" />
              </div>
              <div>
                <Label htmlFor="new-room-logo">{t('companies.logoUrl')}</Label>
                <Input id="new-room-logo" name="logo_url" type="url" dir="ltr" />
              </div>
              <div>
                <Label htmlFor="new-room-day">{t('companies.roomDay')}</Label>
                <Input id="new-room-day" name="day" type="date" dir="ltr" defaultValue={toDateInput(new Date())} required />
              </div>
              <div>
                <Label htmlFor="new-room-start">{t('companies.roomStart')}</Label>
                <Input id="new-room-start" name="start_time" type="time" dir="ltr" step={300} defaultValue="14:00" required />
              </div>
              <div>
                <Label htmlFor="new-room-end">{t('companies.roomEnd')}</Label>
                <Input id="new-room-end" name="end_time" type="time" dir="ltr" step={300} defaultValue="20:00" required />
              </div>
            </div>
            <p className="text-xs text-ink-muted">{t('companies.addRoomHint')}</p>
          </ActionForm>
        </Disclosure>
      ) : null}

      {activeCompanies.length === 0 ? (
        <EmptyState>{t('companies.empty')}</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {activeCompanies.map((company) => {
            const c = counters.get(company.id);
            const room = roomFor(company);
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
                    <span className="font-semibold">{room?.name ?? localized(company, 'name', locale)}</span>
                    <p className="text-sm text-ink-muted">{localized(company, 'name', locale)}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {t('decision.accepted')}: <span className="ltr-nums">{c?.accepted ?? 0}</span> ·{' '}
                      {t('overview.bookedOfSlots')}:{' '}
                      <span className="ltr-nums">
                        {c?.slots_booked ?? 0} / {c?.slots_total ?? 0}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Only the candidate link needs 0005 (candidate_token); everything
                    else here runs on 0001's functions, so it shows on every room. */}
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

                    {manage ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Disclosure label={tCommon('edit')} title={room?.name ?? localized(company, 'name', locale)}>
                          <RoomForm locale={locale} projectId={id} company={company} room={room} t={t} tCommon={tCommon} />
                        </Disclosure>
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
                          {sheets[company.id] ? (
                            <a
                              href={sheets[company.id].url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block break-all text-sm font-medium text-brand-600 hover:underline"
                              dir="ltr"
                            >
                              {sheets[company.id].url}
                            </a>
                          ) : null}
                          <ActionForm
                            action={syncCompanySheetAction}
                            submitLabel={sheets[company.id] ? t('companies.sheetSync') : t('companies.sheetCreate')}
                            variant="secondary"
                            className="space-y-2"
                          >
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="project_id" value={id} />
                            <input type="hidden" name="company_id" value={company.id} />
                          </ActionForm>
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

      {manage && deletedCompanies.length > 0 ? (
        <Disclosure label={t('companies.deletedSection', { count: deletedCompanies.length })}>
          <ul className="space-y-2">
            {deletedCompanies.map((company) => (
              <li key={company.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="text-sm text-ink-muted">{localized(company, 'name', locale)}</span>
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

/** Edits a room's booth label and the company sitting in it, separately. */
function RoomForm({
  locale,
  projectId,
  company,
  room,
  t,
  tCommon,
}: {
  locale: string;
  projectId: string;
  company: Company;
  room?: Room;
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
          <Input id={`${company.id}-name`} name="name" defaultValue={room?.name ?? company.name_en} required />
        </div>
        <div>
          <Label htmlFor={`${company.id}-company_name`}>{t('companies.companyName')}</Label>
          <Input id={`${company.id}-company_name`} name="company_name" defaultValue={company.name_en} />
        </div>
        <div>
          <Label htmlFor={`${company.id}-company_name_ar`}>{t('companies.companyNameAr')}</Label>
          <Input id={`${company.id}-company_name_ar`} name="company_name_ar" dir="rtl" defaultValue={company.name_ar} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`${company.id}-logo_url`}>{t('companies.logoUrl')}</Label>
          {company.logo_url?.startsWith('data:') ? (
            // Uploaded on the Applicants tab and stored as the image itself
            // (LogoInput): carried through unchanged rather than shown as a
            // page of base64 in a text box.
            <>
              <input type="hidden" name="logo_url" value={company.logo_url} />
              <p id={`${company.id}-logo_url`} className="text-xs text-ink-muted">
                {t('companies.logoUploaded')}
              </p>
            </>
          ) : (
            <Input
              id={`${company.id}-logo_url`}
              name="logo_url"
              type="url"
              dir="ltr"
              defaultValue={company.logo_url ?? ''}
            />
          )}
        </div>
      </div>
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
