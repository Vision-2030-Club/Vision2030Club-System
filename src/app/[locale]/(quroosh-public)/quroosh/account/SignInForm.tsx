import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Input, Label, cx } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { requestSignInAction } from './actions';

/**
 * "Send me a sign-in link": one field, the guest's email. Used by the account
 * page and by the session check-in page. `next` is the page to come back to
 * once the emailed link has signed this device in (see `rememberReturnPath`).
 *
 * `look` lets a page with its own design (the check-in) give the field its
 * label, hint and button words, a mail icon in the field, and a big button;
 * without it the form is the account page's, as before.
 *
 * `action` replaces what the form does with the email. The session check-in
 * uses it to let a guest in with the email alone, no link sent (0011).
 */
export async function SignInForm({
  locale,
  projectId,
  next,
  look,
  action,
}: {
  locale: string;
  projectId: string;
  next?: string;
  look?: { label: string; hint: string; submit: string };
  action?: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const t = await getTranslations('quroosh.account.signIn');
  return (
    <ActionForm
      action={action ?? requestSignInAction}
      submitLabel={look?.submit ?? t('submit')}
      successText={t('sent')}
      className={look ? 'space-y-5' : undefined}
      submitClassName={
        look
          ? 'min-h-13 w-full rounded-2xl! text-base! font-semibold! shadow-lg shadow-brand-600/25'
          : undefined
      }
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="project_id" value={projectId} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {/* Hidden from people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -start-[9999px] size-px overflow-hidden">
        <label htmlFor="signin-website">Website</label>
        <input id="signin-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <Label htmlFor="signin-email">{look?.label ?? t('email')}</Label>
        {/* The address reads left to right in both languages, so the icon sits on its left. */}
        <div className="relative" dir="ltr">
          {look ? <MailIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-brand-400" /> : null}
          <Input
            id="signin-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            required
            maxLength={254}
            placeholder={look ? 'name@example.com' : undefined}
            className={cx(look && 'min-h-12 rounded-xl! border-brand-200 bg-brand-100 ps-11 text-base')}
          />
        </div>
        {look ? <p className="mt-3 text-sm leading-relaxed text-ink-muted">{look.hint}</p> : null}
      </div>
    </ActionForm>
  );
}

export function MailIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
