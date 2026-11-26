import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { QurooshThemeKeeper } from '@/components/QurooshThemeKeeper';

/**
 * The frame of the stage screen (/quroosh/stage/...), apart from the other
 * Quroosh public pages because it has none: the page is a fixed 1620x3240
 * canvas for the stage's screen and fills the window itself. Only the
 * identity's type, and the Quroosh palette kept on (the root layout's inline
 * script paints `/quroosh/...` on a full load). The proxy lets `/quroosh/...`
 * through without a session.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function QurooshStageLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="quroosh-type">
      <QurooshThemeKeeper />
      {children}
    </div>
  );
}
