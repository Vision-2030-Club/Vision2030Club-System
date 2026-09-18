import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui';
import { localized } from '@/lib/format';
import type { Company } from '@/lib/interviews/types';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { RoomLoginForm } from './RoomLoginForm';

/**
 * One room's public face (0005): whoever holds this link identifies
 * themselves with a name and phone number, and — if HR already accepted them
 * for this company — is sent straight to their booking page. The link is
 * looked up by `candidate_token`, a column separate from `access_token`
 * (that one is the company's OWN interviewer page, unrelated to this).
 */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('interviews');

  if (!isInterviewsConfigured()) notFound();
  const db = createInterviewsClient();

  const { data } = await db.from('companies').select('*').eq('candidate_token', token).maybeSingle();
  const company = data as Company | null;
  if (!company) notFound();

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        {company.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logo_url}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-lg border border-line bg-white object-contain p-1"
          />
        ) : null}
        <h1 className="text-2xl font-semibold text-ink">{localized(company, 'name', locale)}</h1>
      </div>
      <p className="mb-5 text-sm text-ink-muted">{t('room.intro')}</p>
      <Card>
        <RoomLoginForm locale={locale} token={token} />
      </Card>
    </>
  );
}
