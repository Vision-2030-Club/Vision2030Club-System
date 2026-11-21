import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Input, Label } from '@/components/ui';
import { requestSignInAction } from './actions';

/**
 * "Send me a sign-in link": one field, the guest's email. Used by the account
 * page and by the session check-in page. `next` is the page to come back to
 * once the emailed link has signed this device in (see `rememberReturnPath`).
 */
export async function SignInForm({ locale, projectId, next }: { locale: string; projectId: string; next?: string }) {
  const t = await getTranslations('quroosh.account.signIn');
  return (
    <ActionForm action={requestSignInAction} submitLabel={t('submit')} successText={t('sent')}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="project_id" value={projectId} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {/* Hidden from people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -start-[9999px] size-px overflow-hidden">
        <label htmlFor="signin-website">Website</label>
        <input id="signin-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <Label htmlFor="signin-email">{t('email')}</Label>
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
  );
}
