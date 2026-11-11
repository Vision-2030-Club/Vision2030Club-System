import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Disclosure } from '@/components/Disclosure';
import { Alert, Badge, Card, EmptyState, Label, PageHeader, Textarea } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { formatDate, localized } from '@/lib/format';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { GUEST_STATUS_TONE, invitationStatus, loadInvitations, slotDay } from '@/lib/quroosh/guests';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { createInvitationAction } from './actions';
import { RequiredInput } from './RequiredField';
import { TitleField } from './TitleField';

/**
 * The guests invited to the project's Quroosh event (Quroosh 0005), for its
 * managers only: each guest's name and status, newest first, and the form
 * that invites one. Speakers only for now, so there is no role to pick. A
 * guest's own page has their link and QR code; the slots they book from
 * are on the Slots page.
 */
export default async function QurooshGuestsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getQurooshAccess(id);
  if (!access || !can.manage(access.role)) notFound();

  const t = await getTranslations('quroosh');
  const header = <PageHeader title={t('guests.title')} description={localized(access.project, 'name', locale)} />;
  if (!isQurooshConfigured()) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('applications.notConfigured')}</Alert>
      </>
    );
  }

  const { ready, invitations } = await loadInvitations(createQurooshClient(), id);
  if (!ready) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('guests.notReady')}</Alert>
      </>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{t('guests.slots.title')}</p>
          <p className="mt-1 text-xs text-ink-muted">{t('guests.slotsCardHint')}</p>
        </div>
        <Link
          href={`/projects/${id}/quroosh/guests/slots`}
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t('guests.manageSlots')}
        </Link>
      </Card>

      <Disclosure label={t('guests.new.label')} title={t('guests.new.title')}>
        <ActionForm action={createInvitationAction} submitLabel={t('guests.new.submit')}>
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="locale" value={locale} />
          <p className="text-sm text-ink-muted">{t('guests.new.intro')}</p>
          <TitleField />
          <div>
            <Label htmlFor="guest-name">{t('guests.new.name')}</Label>
            <RequiredInput
              id="guest-name"
              name="name"
              maxLength={200}
              autoComplete="off"
              message={t('guests.required.name')}
            />
            <p className="mt-1 text-xs text-ink-muted">{t('guests.new.nameHint')}</p>
          </div>
          <div>
            <Label htmlFor="guest-note">{t('guests.new.note')}</Label>
            <Textarea id="guest-note" name="note" rows={3} maxLength={2000} />
            <p className="mt-1 text-xs text-ink-muted">{t('guests.new.noteHint')}</p>
          </div>
        </ActionForm>
      </Disclosure>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">{t('guests.count', { count: invitations.length })}</h2>
        {invitations.length === 0 ? (
          <EmptyState>{t('guests.empty')}</EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
            {invitations.map((guest) => {
              const status = invitationStatus(guest);
              const bookedDay = status === 'booked' && guest.slot_starts_at ? slotDay(guest.slot_starts_at, locale) : null;
              return (
                <li key={guest.id}>
                  <Link
                    href={`/projects/${id}/quroosh/guests/${guest.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 hover:bg-surface-muted"
                  >
                    <span className="font-semibold text-ink">{guest.name}</span>
                    <Badge tone={GUEST_STATUS_TONE[status]}>{t(`guests.status.${status}`)}</Badge>
                    <span className="text-sm text-ink-muted">{t(`guests.role.${guest.role}`)}</span>
                    <span className="ms-auto text-xs text-ink-muted">
                      {t('guests.invitedOn', { date: formatDate(guest.created_at, locale) })}
                    </span>
                    {bookedDay ? (
                      <span className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink">
                        <span>{bookedDay}</span>
                        {guest.phone ? (
                          <span className="ltr-nums text-ink-muted" dir="ltr">
                            {guest.phone}
                          </span>
                        ) : null}
                        {guest.needs_transport ? <Badge tone="warn">{t('guests.needsTransport')}</Badge> : null}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
