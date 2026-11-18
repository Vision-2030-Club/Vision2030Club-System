import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

/**
 * The frame around Event attendance's public pages (0075): the sign-up form
 * and a person's pass. No sidebar and no profile. The proxy lets `/event/...`
 * through without a session.
 *
 * The header is not here: each page knows which project it is for, and so
 * whose identity to wear (`EventFrame`).
 */

// A pass link is a secret, and a sign-up form is not something to find by
// searching: neither belongs in a search engine.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EventPublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <div className="min-h-dvh bg-canvas">{children}</div>;
}
