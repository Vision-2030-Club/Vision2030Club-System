import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Alert, Badge, Card, Label, PageHeader, Select } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { formatDateTime, localized } from '@/lib/format';
import { qrDataUrls } from '@/lib/links';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import {
  GUEST_STATUS_TONE,
  invitationStatus,
  invitationUrl,
  loadInvitation,
  loadSlots,
  slotDay,
} from '@/lib/quroosh/guests';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
// The interviews' copy field: a secret link shown to copy, never linked.
import { CopyField } from '../../../interviews/CopyField';
import { cancelBookingAction, cancelInvitationAction, moveBookingAction } from '../actions';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * One invited guest (Quroosh 0005), for the project's managers only: their
 * personal link to copy, its QR code (an SVG on the page, a PNG to download
 * for WhatsApp or a slide), and cancelling the invitation.
 *
 * The link is the guest's only key, so it is shown to copy rather than
 * linked (opening it here would leave it in the manager's history), and it
 * and the QR code are hidden once the invitation is cancelled.
 */
export default async function QurooshGuestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; guestId: string }>;
}) {
  const { locale, id, guestId } = await params;
  setRequestLocale(locale);
  if (!UUID.test(guestId)) notFound();

  const access = await getQurooshAccess(id);
  if (!access || !can.manage(access.role)) notFound();

  const t = await getTranslations('quroosh');
  const back = { href: `/projects/${id}/quroosh/guests`, label: t('guests.title') };
  if (!isQurooshConfigured()) {
    return (
      <>
        <PageHeader title={t('guests.title')} description={localized(access.project, 'name', locale)} back={back} />
        <Alert tone="warn">{t('applications.notConfigured')}</Alert>
      </>
    );
  }

  const db = createQurooshClient();
  const [{ ready, invitation }, { slots }] = await Promise.all([loadInvitation(db, id, guestId), loadSlots(db, id)]);
  if (!ready) {
    return (
      <>
        <PageHeader title={t('guests.title')} description={localized(access.project, 'name', locale)} back={back} />
        <Alert tone="warn">{t('guests.notReady')}</Alert>
      </>
    );
  }
  if (!invitation) notFound();

  const status = invitationStatus(invitation);
  const link = status === 'cancelled' ? null : invitationUrl(locale, invitation.token);
  const qr = link ? await qrDataUrls(link) : null;
  const bookedDay = status === 'booked' && invitation.slot_starts_at ? slotDay(invitation.slot_starts_at, locale) : null;
  // Where a booking can move: on, still offered (its day not yet begun), nobody's.
  const freeSlots = slots.filter((slot) => slot.active && !slot.past && !slot.guest);
  const hidden = (
    <>
      <input type="hidden" name="project_id" value={id} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="invitation_id" value={invitation.id} />
    </>
  );
  const phone = (value: string) => (
    <a href={`tel:${value}`} dir="ltr" className="ltr-nums text-brand-700 underline">
      {value}
    </a>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={invitation.name}
        description={t(`guests.role.${invitation.role}`)}
        back={back}
        action={<Badge tone={GUEST_STATUS_TONE[status]}>{t(`guests.status.${status}`)}</Badge>}
      />

      <Card>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
          <dt className="text-sm font-medium text-ink-muted">{t('guests.guest.invited')}</dt>
          <dd className="text-sm text-ink">{formatDateTime(invitation.created_at, locale)}</dd>
          {invitation.cancelled_at ? (
            <>
              <dt className="text-sm font-medium text-ink-muted">{t('guests.guest.cancelled')}</dt>
              <dd className="text-sm text-ink">{formatDateTime(invitation.cancelled_at, locale)}</dd>
            </>
          ) : null}
          <dt className="text-sm font-medium text-ink-muted">{t('guests.guest.note')}</dt>
          <dd className="whitespace-pre-line text-sm text-ink">
            {invitation.note ?? <span className="text-ink-muted">—</span>}
          </dd>
          {/* The phones stay after a booking is cancelled, so the guest can still be reached. */}
          {invitation.phone ? (
            <>
              <dt className="text-sm font-medium text-ink-muted">{t('guests.guest.phone')}</dt>
              <dd className="text-sm text-ink">{phone(invitation.phone)}</dd>
              <dt className="text-sm font-medium text-ink-muted">{t('guests.guest.transport')}</dt>
              <dd className="text-sm text-ink">
                {invitation.needs_transport ? t('guests.guest.transportYes') : t('guests.guest.transportNo')}
              </dd>
            </>
          ) : null}
          {invitation.needs_transport && invitation.transport_phone ? (
            <>
              <dt className="text-sm font-medium text-ink-muted">{t('guests.guest.transportPhone')}</dt>
              <dd className="text-sm text-ink">{phone(invitation.transport_phone)}</dd>
            </>
          ) : null}
        </dl>
      </Card>

      {bookedDay ? (
        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">{t('guests.booking.title')}</h2>
            <p className="mt-2 text-lg font-semibold text-ink">{bookedDay}</p>
            {invitation.booked_at ? (
              <p className="mt-1 text-xs text-ink-muted">
                {t('guests.booking.bookedAt', { date: formatDateTime(invitation.booked_at, locale) })}
              </p>
            ) : null}
          </div>

          {freeSlots.length > 0 ? (
            <ActionForm action={moveBookingAction} submitLabel={t('guests.booking.move')} variant="secondary">
              {hidden}
              <div>
                <Label htmlFor="move-slot">{t('guests.booking.moveTo')}</Label>
                <Select id="move-slot" name="slot_id" required defaultValue="">
                  <option value="" disabled>
                    {t('guests.booking.choose')}
                  </option>
                  {freeSlots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slotDay(slot.starts_at, locale)}
                    </option>
                  ))}
                </Select>
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-ink-muted">
              {t('guests.booking.noFree')}{' '}
              <Link href={`/projects/${id}/quroosh/guests/slots`} className="text-brand-700 underline">
                {t('guests.manageSlots')}
              </Link>
            </p>
          )}

          <ConfirmForm
            action={cancelBookingAction}
            trigger={t('guests.booking.cancel.trigger')}
            title={t('guests.booking.cancel.title')}
            body={t('guests.booking.cancel.body', { name: invitation.name })}
            confirmLabel={t('guests.booking.cancel.confirm')}
            variant="secondary"
          >
            {hidden}
          </ConfirmForm>
        </Card>
      ) : null}

      {link && qr ? (
        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">{t('guests.guest.shareTitle')}</h2>
            <p className="mt-1 text-sm text-ink-muted">{t('guests.guest.shareHint')}</p>
          </div>
          <CopyField label={t('guests.guest.link')} value={link} />
          {/* A data URL made on the server: nothing for next/image to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr.svg}
            alt={t('guests.guest.qrAlt', { name: invitation.name })}
            width={160}
            height={160}
            className="size-40 rounded-lg border border-line"
          />
          <div className="flex flex-wrap gap-2 text-sm">
            <a
              href={qr.png}
              download="quroosh-invitation-qr.png"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-ink hover:bg-surface-muted"
            >
              {t('guests.guest.downloadQr')}
            </a>
          </div>
        </Card>
      ) : (
        <Alert tone="warn">{t('guests.guest.cancelledNote')}</Alert>
      )}

      {status === 'cancelled' ? null : (
        <ConfirmForm
          action={cancelInvitationAction}
          trigger={t('guests.cancel.trigger')}
          title={t('guests.cancel.title')}
          body={t('guests.cancel.body', { name: invitation.name })}
          confirmLabel={t('guests.cancel.confirm')}
        >
          {hidden}
        </ConfirmForm>
      )}
    </div>
  );
}
