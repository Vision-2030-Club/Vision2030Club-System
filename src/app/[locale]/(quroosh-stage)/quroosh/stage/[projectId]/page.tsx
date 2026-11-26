import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { qrDataUrls } from '@/lib/links';
import { accountHomePath } from '@/lib/quroosh/accounts';
import { getStageSnapshot } from '@/lib/quroosh/stage';
import { isProjectId } from '@/lib/quroosh/stageBoard';
import { siteUrl } from '@/lib/site';
import { StageScreen } from './StageScreen';

/**
 * The stage screen (docs/quroosh.md, "The stage screen"): the Final Wave's
 * projects ranked live, drawn on a fixed 1620x3240 canvas for the screen on
 * the stage at the closing ceremony. Nobody touches it.
 *
 * Open to anyone who has the address, with no sign-in (the club's decision,
 * 2026-11-26): it shows what the hall sees anyway, and only a holding screen
 * while the Final Wave is hidden. Renders once on the server and then asks
 * /api/quroosh/stage every two seconds, as the Mock Interviews TV does.
 *
 * Two switches in the address for the stage's computer, so nothing needs a
 * new deployment: `?fit=exact` draws the canvas unscaled from the top-left
 * corner (for a processor that crops exact pixels), and `?rotate=90` or
 * `?rotate=270` turns it for a screen fed sideways.
 */
export default async function QurooshStagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ fit?: string | string[]; rotate?: string | string[] }>;
}) {
  const [{ locale, projectId }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  if (!isProjectId(projectId)) notFound();
  const id = projectId.toLowerCase();

  const [t, initial, qr] = await Promise.all([
    getTranslations('quroosh'),
    // Null when it could not be read: the holding screen, and the screen keeps asking.
    getStageSnapshot(id),
    // The guests' one QR code (GuestStartQr): the production address, like every link people are handed.
    qrDataUrls(`${siteUrl()}/${locale}${accountHomePath(id)}`),
  ]);

  return (
    <StageScreen
      locale={locale}
      name={t('name')}
      initial={initial}
      pollUrl={`/api/quroosh/stage?project=${id}`}
      qr={qr.svg}
      fit={query.fit === 'exact' ? 'exact' : 'contain'}
      rotate={query.rotate === '90' ? 90 : query.rotate === '270' ? 270 : 0}
      labels={{
        title: t('stage.title'),
        open: t('stage.open'),
        closed: t('stage.closed'),
        soon: t('stage.soon'),
        supporters: t('stage.supporters'),
        given: t('stage.given'),
        gifts: t('stage.gifts'),
        unit: t('stage.unit'),
        scan: t('stage.scan'),
        join: t('stage.join'),
        thanks: t('stage.thanks'),
        qrAlt: t('stage.qrAlt'),
      }}
    />
  );
}
