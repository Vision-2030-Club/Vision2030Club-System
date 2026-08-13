import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, PageHeader } from '@/components/ui';
import { ImportForm } from './ImportForm';

export default async function AdminImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('admin');

  return (
    <>
      <PageHeader title={t('import')} description={t('importHint')} />

      <Card className="max-w-3xl">
        <ImportForm locale={locale} />
      </Card>
    </>
  );
}
