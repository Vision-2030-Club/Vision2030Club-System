import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { QurooshFin } from '@/components/QurooshLogo';
import { QurooshWaves } from '@/components/QurooshWaves';

/**
 * The frame of a guest's invitation (/quroosh/invite/<token>), apart from
 * the application form's frame (quroosh-public): the invitation follows the
 * printed speaker card, so the whole page is the Quroosh deep navy-purple,
 * full width, with the card's large curve in a slightly lighter purple
 * behind the content (the fin, much enlarged; clipped, so it never makes the
 * page scroll sideways), the tagline in mint and the waves at the bottom. No
 * header: the logo is part of the invitation itself. The language switch
 * sits small at the top.
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
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-brand-950">
      <QurooshFin className="pointer-events-none absolute start-[-35%] top-[26rem] -z-10 h-[56rem]! text-brand-700/30 sm:start-[-10%] sm:top-[22rem]" />
      <div className="flex justify-end px-4 pt-4">
        <div className="rounded-lg bg-surface">
          <LocaleSwitch />
        </div>
      </div>
      <main className="flex-1 px-4 pb-10">{children}</main>
      <footer>
        <p className="px-4 pb-8 pt-4 text-center text-lg font-bold text-accent-2">{t('footer')}</p>
        <QurooshWaves className="h-16 sm:h-20" />
      </footer>
    </div>
  );
}
