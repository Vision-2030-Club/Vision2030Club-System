import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Card } from '@/components/ui';
import { QurooshLogo } from '@/components/QurooshLogo';
import { QurooshWaves } from '@/components/QurooshWaves';
import { localized } from '@/lib/format';
import { can, getQurooshAccess } from '@/lib/quroosh/access';

/**
 * The Quroosh (قروش) component's front page. A skeleton: the identity on a
 * navy band (the logo, its tagline, the waves) and a word on what is coming.
 * The component's own screens are added as the club decides them; each one
 * becomes an item in the sidebar (see the Quroosh shell in (app)/layout.tsx).
 *
 * Somebody without access gets a 404, not a page of refusals, as in the
 * other components.
 */
export default async function QurooshPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getQurooshAccess(id);
  if (!access) notFound();

  const t = await getTranslations('quroosh');
  const name = localized(access.project, 'name', locale);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-brand-950">
        <div className="flex flex-col items-start gap-4 px-6 pt-8 pb-28 sm:px-10 sm:pt-10 sm:pb-36">
          <Badge tone="brand">{t(`role.${access.role}`)}</Badge>
          <QurooshLogo name={name} className="h-20 text-accent-2 sm:h-28" />
        </div>
        <QurooshWaves className="absolute inset-x-0 bottom-0 h-24 sm:h-32" />
      </section>

      <Card>
        <h2 className="text-lg font-semibold text-ink">{t('overview.title')}</h2>
        <p className="mt-2 text-ink-muted">{t('overview.body')}</p>
        {can.manage(access.role) ? (
          <p className="mt-3 text-sm text-ink-muted">{t('overview.managerNote')}</p>
        ) : null}
      </Card>
    </div>
  );
}
