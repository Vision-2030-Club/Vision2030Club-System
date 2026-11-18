import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Alert, Button, Card, Input, Label } from '@/components/ui';
import { getGuestAccount } from '@/lib/quroosh/accounts';
import { requestSignInAction, signOutAction } from '../actions';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * A guest's Quroosh account: /quroosh/account/<club project id> (Quroosh 0006).
 *
 * Signed in (the session cookie belongs to an account of this project): who
 * they are, and a word on what the account is for. The Quroosh market's
 * pages will start from here, asking `getGuestAccount()` the same question.
 *
 * Not signed in: one field, their email, and a sign-in link is sent to it.
 * The page says the same thing whether or not that email has an account.
 */
export default async function QurooshAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { locale, projectId } = await params;
  const { created } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh.account');

  const account = await getGuestAccount();
  // A session of another project's account is nobody here.
  if (account && account.project_id === projectId) {
    return (
      <div className="mx-auto max-w-md space-y-5">
        {created ? <Alert tone="ok">{t('home.created')}</Alert> : null}
        <div>
          <p className="text-sm text-ink-muted">{t('home.welcome')}</p>
          <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight text-ink">{account.name}</h1>
          <p className="ltr-nums mt-1 break-all text-sm text-ink-muted" dir="ltr">
            {account.email}
          </p>
        </div>
        <Card>
          <h2 className="font-semibold text-ink">{t('home.readyTitle')}</h2>
          <p className="mt-2 text-sm text-ink-muted">{t('home.readyBody')}</p>
        </Card>
        <form action={signOutAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="project_id" value={projectId} />
          <Button type="submit" variant="secondary">
            {t('home.signOut')}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink">{t('signIn.title')}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t('signIn.intro')}</p>
      </div>
      <Card>
        <ActionForm action={requestSignInAction} submitLabel={t('signIn.submit')} successText={t('signIn.sent')}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="project_id" value={projectId} />
          {/* Hidden from people, tempting to bots. */}
          <div aria-hidden="true" className="absolute -start-[9999px] size-px overflow-hidden">
            <label htmlFor="signin-website">Website</label>
            <input id="signin-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="signin-email">{t('signIn.email')}</Label>
            <Input
              id="signin-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              required
              maxLength={254}
            />
          </div>
        </ActionForm>
      </Card>
      <p className="text-xs text-ink-muted">{t('signIn.howToGet')}</p>
    </div>
  );
}
