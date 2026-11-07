import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { QurooshLogo } from '@/components/QurooshLogo';

/**
 * The frame around Quroosh's public pages (the application form): no
 * sidebar, no profile; the Quroosh mark on its navy, a language switch, and
 * the page. The proxy lets `/quroosh/...` through without a session, and the
 * root layout's inline script paints these pages in the Quroosh palette.
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
    <div className="min-h-dvh bg-canvas">
      <header className="bg-brand-950">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-4">
          <QurooshLogo name={t('name')} className="h-12 text-accent-2" />
          <div className="ms-auto rounded-lg bg-surface">
            <LocaleSwitch />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
