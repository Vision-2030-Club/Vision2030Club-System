'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, cx } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { giveFinalAction } from './actions';

/** Quroosh in Latin digits, grouped, as everywhere in the market. */
const format = (amount: number) => new Intl.NumberFormat('en-US').format(amount);

/** The quick amounts offered beside the stepper. */
const PRESETS = [500, 1000, 2500];

/**
 * Giving one Final Wave project quroosh (Quroosh 0014).
 *
 * Closed, it is one button. Open, it is a stepper that moves in steps of
 * 250 (never below one step, never above the balance), a few quick amounts
 * and "all I have", what will be left, and a button that says exactly how
 * much is being sent. The database checks the step and the balance again
 * under a lock; what is shown here is only the guest's choice.
 */
export function GiveForm({
  locale,
  projectId,
  finalProjectId,
  projectName,
  balance,
  step,
}: {
  locale: string;
  projectId: string;
  finalProjectId: string;
  projectName: string;
  balance: number;
  step: number;
}) {
  const t = useTranslations('quroosh.account.final.give');
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(step);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(async (previous, formData) => {
    const result = await giveFinalAction(previous, formData);
    if (result.ok) {
      setOpen(false);
      setAmount(step);
    }
    return result;
  }, { ok: false });

  // The most that can be given: the balance, down to a whole step.
  const most = Math.floor(Math.max(balance, 0) / step) * step;
  // The chosen amount, kept inside what the balance allows (it can shrink after a gift).
  const value = Math.min(Math.max(amount, step), Math.max(most, step));
  const canGive = most >= step;

  const done =
    state.ok && !open && state.data ? (
      <p
        role="status"
        className="flex items-center gap-2 rounded-2xl bg-accent/25 px-4 py-3 text-sm font-semibold text-brand-950 motion-safe:animate-[final-pop_320ms_ease-out]"
      >
        <CoinIcon className="size-5 shrink-0 text-accent-3" />
        <span>{t('sent', { amount: format(Number(state.data.amount)), name: projectName })}</span>
      </p>
    ) : null;

  if (!open) {
    return (
      <div className="space-y-3">
        {done}
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!canGive}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand-950 px-4 text-base font-semibold text-accent-2 shadow-md shadow-brand-950/15 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted disabled:shadow-none"
        >
          <CoinIcon className="size-5" />
          {canGive ? t('open') : t('notEnough', { step: format(step) })}
        </button>
      </div>
    );
  }

  const chip =
    'ltr-nums min-h-10 rounded-full border-2 px-3 text-sm font-semibold tabular-nums transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-2xl border-2 border-accent bg-accent/10 p-4 motion-safe:animate-[final-pop_220ms_ease-out]"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="final_project_id" value={finalProjectId} />
      <input type="hidden" name="amount" value={value} />

      <p className="text-center text-sm font-medium text-ink-muted">{t('howMuch')}</p>

      {/* The stepper. Minus and plus keep their places in both languages, like a number line. */}
      <div dir="ltr" className="flex items-center justify-between gap-3">
        <StepButton label={t('less', { step: format(step) })} onClick={() => setAmount(value - step)} disabled={value <= step}>
          <path d="M5 12h14" />
        </StepButton>
        <div className="min-w-0 flex-1 text-center">
          <p aria-live="polite" className="text-4xl font-bold tracking-tight text-brand-950 tabular-nums">
            {format(value)}
          </p>
          <p className="mt-0.5 text-xs font-medium text-ink-muted" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
            {t('unit')}
          </p>
        </div>
        <StepButton label={t('more', { step: format(step) })} onClick={() => setAmount(value + step)} disabled={value + step > most}>
          <path d="M12 5v14M5 12h14" />
        </StepButton>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setAmount(preset)}
            disabled={preset > most}
            aria-pressed={value === preset}
            className={cx(
              chip,
              value === preset ? 'border-brand-950 bg-brand-950 text-accent-2' : 'border-line bg-surface text-ink',
            )}
          >
            {format(preset)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAmount(most)}
          aria-pressed={value === most}
          className={cx(
            chip,
            value === most ? 'border-brand-950 bg-brand-950 text-accent-2' : 'border-line bg-surface text-ink',
          )}
        >
          {t('all')}
        </button>
      </div>

      <p className="text-center text-xs text-ink-muted">
        {t('left', { left: format(balance - value) })}
      </p>

      {state.error && !state.ok ? (
        <div role="alert">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand-950 px-4 text-base font-semibold text-accent-2 shadow-md shadow-brand-950/15 transition active:scale-[0.98] disabled:opacity-60"
        >
          <CoinIcon className="size-5" />
          {pending ? t('sending') : t('send', { amount: format(value) })}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="min-h-12 rounded-2xl border-2 border-line bg-surface px-4 text-sm font-semibold text-ink-muted hover:bg-surface-muted"
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-14 shrink-0 place-items-center rounded-full border-2 border-brand-950 bg-surface text-brand-950 transition active:scale-90 disabled:cursor-not-allowed disabled:border-line disabled:text-ink-muted"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

/** A small stack of coins, the market's mark on its buttons. */
export function CoinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v4c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
      <path d="M5 10v4c0 1.66 3.13 3 7 3s7-1.34 7-3v-4" />
      <path d="M5 14v4c0 1.66 3.13 3 7 3s7-1.34 7-3v-4" />
    </svg>
  );
}
