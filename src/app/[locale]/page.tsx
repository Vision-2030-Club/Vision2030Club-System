import { redirect } from '@/i18n/navigation';

export default async function LocaleIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // The proxy has already decided whether this visitor is signed in, so
  // sending everyone to the dashboard is safe: signed-out users get bounced
  // back to /login on the next request.
  redirect({ href: '/dashboard', locale });
}
