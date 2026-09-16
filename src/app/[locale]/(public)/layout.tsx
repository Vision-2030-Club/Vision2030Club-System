import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleSwitch } from '@/components/LocaleSwitch';

/**
 * The frame around the pages people reach WITHOUT signing in: the apply
 * form, a student's personal link, a company's interviewer link, the TV.
 * No sidebar, no profile — a logo, a language switch, and the page. The
 * proxy lets these paths through; each page then checks its own token.
 */
export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app');

  return (
    <div className="min-h-dvh bg-surface-muted">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
          <Image
            src="/brand/logo-horizontal.png"
            alt={t('name')}
            width={200}
            height={48}
            priority
            className="h-8 w-auto"
          />
          <div className="ms-auto">
            <LocaleSwitch />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
