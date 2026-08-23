import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, PageHeader } from '@/components/ui';
import { toDateTimeInput } from '@/lib/format';
import { EntryForm } from '../EntryForm';
import { loadEntryFormOptions } from '../options';

export default async function NewCalendarEntryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('calendar');

  // What may be scheduled directly comes from the calendar.manage scope; see
  // loadEntryFormOptions, which /calendar/[id] shares.
  const options = await loadEntryFormOptions(locale);

  const now = new Date();
  const inAnHour = new Date(now.getTime() + 60 * 60 * 1000);

  return (
    <>
      <PageHeader title={t('newEntry')} description={t('subtitle')} />

      <Card className="max-w-2xl">
        <EntryForm
          locale={locale}
          defaultStart={toDateTimeInput(now)}
          defaultEnd={toDateTimeInput(inAnHour)}
          {...options}
        />
      </Card>
    </>
  );
}
