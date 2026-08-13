import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { LoginForm } from './LoginForm';

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app');
  const tAuth = await getTranslations('auth');

  return (
    <main className="grid min-h-dvh place-items-center bg-surface-muted p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Image
            src="/brand/logo-vertical.png"
            alt={t('name')}
            width={160}
            height={160}
            priority
            className="h-24 w-auto"
          />
          <p className="text-sm text-ink-muted">{t('tagline')}</p>
        </div>

        <Card>
          <h1 className="mb-4 text-lg font-semibold">{tAuth('signIn')}</h1>
          <LoginForm locale={locale} />
        </Card>

        <div className="mt-4 flex justify-center">
          <LocaleSwitch />
        </div>
      </div>
    </main>
  );
}
