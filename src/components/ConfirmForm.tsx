'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, cx } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';

/**
 * A server-action form whose submit button opens a confirmation pop-up first.
 *
 * Addendum §7 requires this for task deletion: "no silent/one-click deletes".
 * A native <dialog> gives a real modal — focus trapped, Escape closes, and the
 * page behind it inert — without a dependency or a hand-rolled focus manager.
 */
export function ConfirmForm({
  action,
  children,
  trigger,
  title,
  body,
  confirmLabel,
  variant = 'danger',
  className,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  /** Hidden inputs carrying the row's identity. */
  children?: ReactNode;
  trigger: string;
  title: string;
  body: string;
  confirmLabel: string;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
}) {
  const t = useTranslations('common');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {
    ok: false,
  });

  /*
   * Once the action succeeds the row is gone, so the dialog should not stay up
   * pointing at something that no longer exists. That is derived rather than
   * stored: a second `setOpen(false)` in an effect would just be state React
   * can already compute.
   */
  const isOpen = open && !state.ok;

  // showModal() has no declarative form, so this effect syncs the one external
  // system involved — the <dialog> element — with the derived value.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </Button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        className={cx(
          // `m-auto` is load-bearing: a modal <dialog> centres itself with
          // margin:auto, and Tailwind's preflight resets margin to 0, which
          // parks the dialog in the top-left corner.
          'm-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0',
          'text-ink shadow-lg backdrop:bg-ink/40',
        )}
      >
        <form action={formAction} className="space-y-3 p-5">
          {children}

          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-ink-muted">{body}</p>

          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant={variant} disabled={pending}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
