import { getTranslations, setRequestLocale } from 'next-intl/server';
import { QurooshPage } from '@/components/QurooshHero';

/**
 * The frame around Quroosh's public pages (the guest account, challenges,
 * application form): no sidebar, no profile; the identity's page design
 * (`QurooshPage`): the navy hero with the logo and the coins, the page on the
 * light body below it, the navy wave closing it. Each page writes its own
 * heading in the body. The session check-in has its own frame, with its
 * title in the hero, in (quroosh-checkin). The proxy lets `/quroosh/...`
 * through without a session, and the root layout's inline script paints
 * these pages in the Quroosh palette.
 */
export default async function QurooshPublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh');

  return (
    <div className="quroosh-type flex min-h-dvh flex-col bg-canvas">
      <QurooshPage name={t('name')} width="max-w-xl">
        {children}
      </QurooshPage>
    </div>
  );
}
