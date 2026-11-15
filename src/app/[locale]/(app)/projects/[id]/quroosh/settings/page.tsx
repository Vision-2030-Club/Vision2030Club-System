import { setRequestLocale } from 'next-intl/server';
import { SectionPlaceholder } from '../SectionPlaceholder';

/**
 * The platform's settings: the coin rules, the event's dates and clocks, and the deal room's timetable.
 *
 * This folder belongs to the section's owner: its screens, their components
 * and server actions live here, its loaders in src/lib/quroosh/settings/, and
 * its words under quroosh.settings in both message catalogs. The screens it is
 * to hold are listed in docs/quroosh.md. Replace the placeholder below with
 * the section's first real screen.
 */
export default async function QurooshSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return <SectionPlaceholder locale={locale} projectId={id} section="settings" />;
}
