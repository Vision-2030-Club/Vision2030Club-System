import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { QurooshWaves } from '@/components/QurooshWaves';

/**
 * The frame of a guest's invitation (/quroosh/invite/<token>), apart from
 * the application form's frame (quroosh-public): the invitation follows the
 * printed invitation cards, so the whole page is the Quroosh navy, full
 * width, with the tagline in mint and the waves at the bottom. No header: the
 * logo is part of the invitation itself. The language switch sits small at
 * the top.
 *
 * The proxy lets `/quroosh/...` through without a session, and the root
 * layout's inline script paints these pages in the Quroosh palette.
 */
export default async function QurooshInviteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh.invite');

  return (
    <div className="flex min-h-dvh flex-col bg-brand-950">
      <div className="flex justify-end px-4 pt-4">
        <div className="rounded-lg bg-surface">
          <LocaleSwitch />
        </div>
      </div>
      <main className="flex-1 px-4 pb-10">{children}</main>
      <footer>
        <p className="px-4 pb-6 text-center text-sm font-semibold text-accent-2">{t('footer')}</p>
        <QurooshWaves className="h-16 sm:h-20" />
      </footer>
    </div>
  );
}
