import { redirect } from '@/i18n/navigation';

/**
 * Guests (Quroosh 0005). The sidebar's "Guests" item lands here. Until the
 * list of invited guests is built, this sends the manager on to the slots
 * page, which checks who may see it.
 */
export default async function QurooshGuestsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  redirect({ href: `/projects/${id}/quroosh/guests/slots`, locale });
}
