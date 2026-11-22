import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

/**
 * The frame of the dialogue session's check-in (/quroosh/checkin/...), kept
 * apart from the other Quroosh guest pages because its design is its own: a
 * navy hero with the page's title (drawn by the page, `QurooshHero`) over a
 * light lavender body. The URL is the same as before; route groups do not
 * show in it, so the printed QR code still opens this page. The root layout
 * paints `/quroosh/...` in the Quroosh palette.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function QurooshCheckInLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <div className="quroosh-type flex min-h-dvh flex-col bg-canvas">{children}</div>;
}
