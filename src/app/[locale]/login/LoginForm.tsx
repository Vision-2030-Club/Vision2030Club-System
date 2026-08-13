'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label } from '@/components/ui';
import { loginAction, type LoginState } from './actions';

export function LoginForm({ locale }: { locale: string }) {
  const t = useTranslations('auth');
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    { step: 'email', email: '' },
  );

  const intent =
    state.step === 'email'
      ? 'lookup'
      : state.step === 'set-password'
        ? 'set-password'
        : 'signin';

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="intent" value={intent} />

      {state.step === 'email' ? (
        <div>
          <Label htmlFor="email">{t('email')}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            autoComplete="username"
            required
            autoFocus
            defaultValue={state.email}
          />
          <p className="mt-2 text-xs text-ink-muted">{t('emailStepHint')}</p>
        </div>
      ) : (
        <>
          {/* Carry the resolved email forward without letting it be edited. */}
          <input type="hidden" name="email" value={state.email} />
          <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-muted">
            <span dir="ltr">{state.email}</span>
          </div>
        </>
      )}

      {state.step === 'set-password' ? (
        <>
          <Alert tone="info">{t('setPasswordHint')}</Alert>
          <div>
            <Label htmlFor="password">{t('password')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              required
              autoFocus
              minLength={8}
            />
          </div>
          <div>
            <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
        </>
      ) : null}

      {state.step === 'password' ? (
        <div>
          <Label htmlFor="password">{t('password')}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
            autoFocus
          />
          <p className="mt-2 text-xs text-ink-muted">{t('noSelfReset')}</p>
        </div>
      ) : null}

      {state.error ? <Alert>{t(state.error)}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full">
        {state.step === 'email' ? t('continue') : t('signIn')}
      </Button>
    </form>
  );
}
