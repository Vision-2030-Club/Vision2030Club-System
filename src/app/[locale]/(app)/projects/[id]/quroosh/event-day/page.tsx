import { setRequestLocale } from 'next-intl/server';
import { SectionPlaceholder } from '../SectionPlaceholder';

/**
 * Event day (21–24 Nov): the gate, the attendees' wallet and challenges, the booths, the founders' board, and the team's live view.
 *
 * This folder belongs to the section's owner: its screens, their components
 * and server actions live here, its loaders in src/lib/quroosh/event-day/, and
 * its words under quroosh.eventDay in both message catalogs. The screens it is
 * to hold are listed in docs/quroosh.md. Replace the placeholder below with
 * the section's first real screen.
 */
export default async function QurooshEventDayPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return <SectionPlaceholder locale={locale} projectId={id} section="eventDay" />;
}
