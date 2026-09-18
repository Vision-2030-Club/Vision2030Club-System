import { getTranslations, setRequestLocale } from 'next-intl/server';
import { InterviewsLogo } from '@/components/InterviewsLogo';
import { LocaleSwitch } from '@/components/LocaleSwitch';

/**
 * The frame around the pages people reach WITHOUT signing in: the apply
 * form, a student's personal link, a company's interviewer link, the TV.
 * No sidebar, no profile — the افترض mark, a language switch, and the page.
 * These pages are the component's own face, so they carry its brand rather
 * than the club's. The proxy lets these paths through; each page then checks
 * its own token.
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
          <InterviewsLogo name={t('name')} className="h-9" />
          <div className="ms-auto">
            <LocaleSwitch />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
