import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { routing, localeDirection, type Locale } from '@/i18n/routing';
import { plexArabic, gilroy } from '@/lib/fonts';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Vision Club 2030',
  description: 'Vision 2030 Club management system',
  manifest: '/manifest.webmanifest',
  // What "Add to Home Screen" on iOS reads. Without `capable` the icon opens
  // a Safari tab, and a Safari tab cannot receive push — see app/manifest.ts.
  appleWebApp: {
    capable: true,
    // The name iOS pre-fills in "Add to Home Screen".
    title: 'Vision 2030 Club',
    statusBarStyle: 'default',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#007a8f',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      dir={localeDirection[locale as Locale]}
      className={`${plexArabic.variable} ${gilroy.variable} h-full`}
      // The inline script below adds `data-theme` before React hydrates.
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased">
        {/*
          Which colours the first paint uses. A project component's pages
          (and the public interviews pages) wear the interviews palette; the
          shell keeps this attribute in step afterwards. Setting it here,
          before anything renders, is what stops a direct load of such a page
          from painting teal and then fading to violet.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var p=location.pathname;if(/^\\/(ar|en)\\/(projects\\/[^/]+\\/interviews|interviews)(\\/|$)/.test(p)){document.documentElement.setAttribute('data-theme','interviews')}})();",
          }}
        />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
