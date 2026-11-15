import { setRequestLocale } from 'next-intl/server';
import { SectionPlaceholder } from '../SectionPlaceholder';

/**
 * The stage (26 Nov, the final wave): the stage console, the six investors' tablets, the attendees' votes, the big screen and the results.
 *
 * This folder belongs to the section's owner: its screens, their components
 * and server actions live here, its loaders in src/lib/quroosh/stage/, and
 * its words under quroosh.stage in both message catalogs. The screens it is
 * to hold are listed in docs/quroosh.md. Replace the placeholder below with
 * the section's first real screen.
 */
export default async function QurooshStagePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return <SectionPlaceholder locale={locale} projectId={id} section="stage" />;
}
