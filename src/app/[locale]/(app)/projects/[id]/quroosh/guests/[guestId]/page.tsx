import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Alert, Badge, Card, PageHeader } from '@/components/ui';
import { formatDateTime, localized } from '@/lib/format';
import { qrDataUrls } from '@/lib/links';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { GUEST_STATUS_TONE, invitationStatus, invitationUrl, loadInvitation } from '@/lib/quroosh/guests';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
// The interviews' copy field: a secret link shown to copy, never linked.
import { CopyField } from '../../../interviews/CopyField';
import { cancelInvitationAction } from '../actions';

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

  const { ready, invitation } = await loadInvitation(createQurooshClient(), id, guestId);
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
        </dl>
      </Card>

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
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="invitation_id" value={invitation.id} />
        </ConfirmForm>
      )}
    </div>
  );
}
