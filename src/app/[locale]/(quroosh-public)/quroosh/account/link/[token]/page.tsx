import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Alert, Card } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { accountHomePath, maskPhone, readAccountLink } from '@/lib/quroosh/accounts';
import { redeemLinkAction } from '../../actions';

// A one-time link is a secret: it does not belong in a search engine.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Where an account email's link lands: /quroosh/account/link/<token>
 * (Quroosh 0006). Opening it changes nothing, so a mail scanner that fetches
 * the link does not spend it: the page shows whose account it is and one
 * button, and the button is what uses the link.
 *
 *   complete  "Complete creating your account": the details from their pass
 *             and "Create my account"
 *   signin    "Sign in as <name>"
 *
 * A link that was used, ran out or belongs to a disabled account says so and
 * points at the sign-in page, where a new one can be asked for.
 */
export default async function QurooshAccountLinkPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh.account');

  const link = await readAccountLink(token);
  if (!link) return <Alert tone="warn">{t('link.notFound')}</Alert>;

  const signInLink = (
    <Link href={accountHomePath(link.project_id)} className="font-medium text-brand-600 hover:underline">
      {t('link.askAgain')}
    </Link>
  );
  if (link.state !== 'valid') {
    return (
      <div className="space-y-3">
        <Alert tone="warn">{t(`link.${link.state}`)}</Alert>
        {link.state === 'disabled' ? null : <p className="text-sm">{signInLink}</p>}
      </div>
    );
  }

  // A completed account opened from an old "complete" link just signs in.
  const creating = !link.completed;
  const phone = maskPhone(link.phone);

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink">
          {creating ? t('link.completeTitle') : t('link.signInTitle', { name: link.name })}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{creating ? t('link.completeIntro') : t('link.signInIntro')}</p>
      </div>

      <Card className="space-y-4">
        {creating ? (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-ink-muted">{t('link.name')}</dt>
              <dd className="font-medium text-ink">{link.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t('link.email')}</dt>
              <dd className="ltr-nums break-all font-medium text-ink" dir="ltr">
                {link.email}
              </dd>
            </div>
            {phone ? (
              <div>
                <dt className="text-xs text-ink-muted">{t('link.mobile')}</dt>
                <dd className="ltr-nums font-medium text-ink" dir="ltr">
                  {phone}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <ActionForm action={redeemLinkAction} submitLabel={creating ? t('link.create') : t('link.signIn')}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="locale" value={locale} />
        </ActionForm>
        {creating ? <p className="text-xs text-ink-muted">{t('link.noPassword')}</p> : null}
      </Card>
    </div>
  );
}
