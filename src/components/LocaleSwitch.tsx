'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useParams } from 'next/navigation';

/**
 * Swaps between the two locales while staying on the same page. `usePathname`
 * from our i18n navigation returns the path WITHOUT the locale prefix, so the
 * router can simply re-render it under the other one.
 */
export function LocaleSwitch() {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const next = locale === 'ar' ? 'en' : 'ar';

  return (
    <button
      type="button"
      onClick={() =>
        router.replace(
          // @ts-expect-error -- pathname is a known route at runtime
          { pathname, params },
          { locale: next },
        )
      }
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50"
    >
      {t('language')}
    </button>
  );
}
