import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, PageHeader } from '@/components/ui';
import { can, getEventAttendanceAccess } from '@/lib/eventAttendance/access';
import type { EventSummary } from '@/lib/eventAttendance/types';
import { localized } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { Scanner } from './Scanner';

/**
 * The gate's scanner (0075), for the project's managers and the HR team:
 * the camera reads a pass, and the attendee is checked in for today.
 */
export default async function EventScanPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getEventAttendanceAccess(id);
  if (!access || !can.scan(access.role)) notFound();

  const t = await getTranslations('eventAttendance');
  const header = <PageHeader title={t('scan.title')} description={localized(access.project, 'name', locale)} />;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('event_attendance_summary', { p_project: id });
  if (error || !data) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('notReady')}</Alert>
      </>
    );
  }

  return (
    <>
      {header}
      <Scanner projectId={id} locale={locale} checkedInToday={(data as EventSummary).checked_in_today} />
    </>
  );
}
