'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { enterPinAction } from './actions';

export function PinForm({ token, locale }: { token: string; locale: string }) {
  const t = useTranslations('interviews');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(enterPinAction, {
    ok: false,
  });

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <div>
        <Label htmlFor="pin">{t('companyPage.pin')}</Label>
        <Input id="pin" name="pin" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,8}" required autoFocus />
      </div>
      {state.error ? <Alert tone="danger">{t('companyPage.wrongPin')}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {t('companyPage.enter')}
      </Button>
    </form>
  );
}
