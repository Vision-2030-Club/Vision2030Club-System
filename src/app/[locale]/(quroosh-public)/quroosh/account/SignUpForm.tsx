'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label, Select } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import type { ActionResult } from '@/lib/actions';
import { DEFAULT_COUNTRY, internationalPhone } from '@/lib/quroosh/phones';
import { signUpAction } from './actions';

export type CountryOption = { iso: string; dial: string; name: string };

/** The identity's field look, as on the sign-in card. */
const FIELD = 'min-h-12 rounded-xl! border-brand-200 bg-brand-100 text-base';

/**
 * A guest makes their own Quroosh account (0017): name, mobile with a
 * country picker, and email. No pass and no email to confirm: on success the
 * server action signs this device in and opens the wallet.
 *
 * As on the event's sign-up form, the guest keeps what they typed whatever
 * goes wrong (the submit is sent from onSubmit, since React resets a form
 * after its own action runs). The mobile is checked here first only so the
 * message can name the field; the server decides. An email or mobile that
 * already has an account gets a way to the sign-in tab.
 */
export function SignUpForm({
  projectId,
  locale,
  countries,
  signInHref,
}: {
  projectId: string;
  locale: string;
  countries: CountryOption[];
  signInHref: string;
}) {
  const t = useTranslations('quroosh.account.signUp');
  const tErrors = useTranslations('quroosh.account.errors');
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (previous, formData) => {
      try {
        const result = await signUpAction(previous, formData);
        // Signed in on this device: open the wallet, bonus included.
        if (result.ok && result.data?.href) router.replace(result.data.href);
        return result;
      } catch {
        return { ok: false, error: tErrors('network'), hint: 'network' };
      }
    },
    { ok: false },
  );
  const [problem, setProblem] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    const valid = internationalPhone(String(formData.get('phone_country') ?? ''), String(formData.get('phone') ?? ''));
    setProblem(valid ? null : tErrors('phone_invalid'));
    if (!valid) return;
    startTransition(() => formAction(formData));
  };

  const error = problem ?? state.error ?? null;
  const toSignIn = state.hint === 'account_exists' || state.hint === 'phone_taken';

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="locale" value={locale} />
      {/* Hidden from people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -start-[9999px] size-px overflow-hidden">
        <label htmlFor="signup-website">Website</label>
        <input id="signup-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <Label htmlFor="signup-name">{t('name')}</Label>
        <Input
          id="signup-name"
          name="name"
          required
          minLength={2}
          maxLength={200}
          autoComplete="name"
          dir="auto"
          className={FIELD}
        />
      </div>

      <div>
        <Label htmlFor="signup-phone">{t('mobile')}</Label>
        <div className="flex flex-col gap-2">
          <Select name="phone_country" defaultValue={DEFAULT_COUNTRY} aria-label={t('country')} className={FIELD}>
            {countries.map(({ iso, dial, name }) => (
              <option key={iso} value={iso}>
                {/* The code kept left-to-right inside Arabic text. */}
                {`${name} ⁦+${dial}⁩`}
              </option>
            ))}
          </Select>
          <Input
            id="signup-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            required
            maxLength={20}
            placeholder="05XXXXXXXX"
            className={FIELD}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="signup-email">{t('email')}</Label>
        <Input
          id="signup-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          required
          maxLength={254}
          placeholder="name@example.com"
          className={FIELD}
        />
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">{t('emailHint')}</p>
      </div>

      {error ? (
        <div className="space-y-2" role="alert">
          <Alert tone="danger">{error}</Alert>
          {toSignIn ? (
            <Link
              href={signInHref}
              className="block text-center text-sm font-semibold text-brand-700 underline underline-offset-4"
            >
              {t('goSignIn')}
            </Link>
          ) : null}
        </div>
      ) : null}

      <Button
        type="submit"
        disabled={pending || state.ok}
        className="min-h-13 w-full rounded-2xl! text-base! font-semibold! shadow-lg shadow-brand-600/25"
      >
        {pending || state.ok ? t('sending') : t('submit')}
      </Button>
    </form>
  );
}
