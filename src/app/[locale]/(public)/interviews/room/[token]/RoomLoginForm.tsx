'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { roomLoginAction } from './actions';

export function RoomLoginForm({ locale, token }: { locale: string; token: string }) {
  const t = useTranslations('interviews');
  const tCommon = useTranslations('common');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(roomLoginAction, {
    ok: false,
  });

  if (state.ok && state.message === 'notAccepted') {
    return <Alert tone="info">{t('room.notAccepted')}</Alert>;
  }

  const errorText = state.error
    ? state.hint && t.has(`errors.${state.hint}`)
      ? t(`errors.${state.hint}`)
      : state.error
    : null;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="room_token" value={token} />
      <input type="hidden" name="locale" value={locale} />

      <div>
        <Label htmlFor="name">{t('room.name')}</Label>
        <Input id="name" name="name" required autoComplete="name" />
      </div>
      <div>
        <Label htmlFor="phone">{t('room.phone')}</Label>
        <Input id="phone" name="phone" type="tel" dir="ltr" required autoComplete="tel" placeholder="05xxxxxxxx" />
      </div>
      <div>
        <Label htmlFor="cv">{t('room.cvFile')}</Label>
        <Input id="cv" name="cv" type="file" accept="application/pdf,.pdf" required />
        <p className="mt-1 text-xs text-ink-muted">{t('room.cvHint')}</p>
      </div>

      {errorText ? <Alert tone="danger">{errorText}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? tCommon('loading') : t('room.submit')}
      </Button>
    </form>
  );
}
