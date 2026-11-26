import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui';
import { accountHomePath } from '@/lib/quroosh/accounts';
import { qrDataUrls } from '@/lib/links';
import { siteUrl } from '@/lib/site';
import { CopyField } from '../interviews/CopyField';

/**
 * The one QR code guests scan to get into Quroosh (0017): it opens the
 * guest's account page, which offers a new account (name, mobile, email, and
 * straight into the wallet) or signing in to one they have; a guest already
 * signed in on the phone lands on their wallet. Shown on the Accounts page
 * and the Final Wave page, to put on the screen or print. It never changes.
 *
 * Like every link people are handed, it is the production address, even on
 * a Vercel preview.
 */
export async function GuestStartQr({ projectId, locale }: { projectId: string; locale: string }) {
  const t = await getTranslations('quroosh.startQr');
  const link = `${siteUrl()}/${locale}${accountHomePath(projectId)}`;
  const qr = await qrDataUrls(link);

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="font-semibold text-ink">{t('title')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('hint')}</p>
      </div>

      {/* The code opens the page when pressed, as well as when scanned. */}
      <a
        href={link}
        target="_blank"
        rel="noopener"
        className="mx-auto block w-fit rounded-2xl border border-line bg-surface p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        aria-label={t('open')}
      >
        {/* A data URL made on the server: nothing for next/image to optimise. The
            picture stays dark on white whatever the theme, so phones can read it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr.svg} alt={t('alt')} width={256} height={256} className="size-56 sm:size-64" />
      </a>

      <div className="mx-auto max-w-md space-y-3">
        <CopyField label={t('link')} value={link} />
        <a
          href={qr.png}
          download="quroosh-guests-qr.png"
          className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t('download')}
        </a>
        <p className="text-xs text-ink-muted">{t('permanent')}</p>
      </div>
    </Card>
  );
}
