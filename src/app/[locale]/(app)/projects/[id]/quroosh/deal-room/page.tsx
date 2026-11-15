import { setRequestLocale } from 'next-intl/server';
import { SectionPlaceholder } from '../SectionPlaceholder';

/**
 * The deal room (25 Nov): investors' invitations and walk-in sign-up, booking meetings, reception, and what comes after a meeting.
 *
 * This folder belongs to the section's owner: its screens, their components
 * and server actions live here, its loaders in src/lib/quroosh/deal-room/, and
 * its words under quroosh.dealRoom in both message catalogs. The screens it is
 * to hold are listed in docs/quroosh.md. Replace the placeholder below with
 * the section's first real screen.
 */
export default async function QurooshDealRoomPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return <SectionPlaceholder locale={locale} projectId={id} section="dealRoom" />;
}
