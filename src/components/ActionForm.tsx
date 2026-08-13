'use client';

import { useActionState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, cx } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';

/**
 * Wraps a server action in a form and renders its result.
 *
 * Failures show the database's own message. That is deliberate: when a write
 * is refused it is refused by a policy or trigger in Postgres, and its message
 * says which rule stopped it — far more useful than a generic "forbidden".
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  successText,
  variant = 'primary',
  className,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submitLabel: string;
  successText?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
}) {
  const t = useTranslations('common');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {
    ok: false,
  });

  return (
    <form action={formAction} className={cx('space-y-3', className)}>
      {children}

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="ok">{successText ?? t('saved')}</Alert> : null}

      <Button type="submit" variant={variant} disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
