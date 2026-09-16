'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { bookAction, cancelAction, moveAction } from './actions';

export type PickableSlot = { id: string; day: string; label: string };

function useRefusal() {
  const t = useTranslations('interviews');
  return (state: ActionResult) =>
    state.error
      ? state.hint && t.has(`errors.${state.hint}`)
        ? t(`errors.${state.hint}`)
        : state.error
      : null;
}

/** Free slots of one company, grouped by day, with one button. */
export function SlotPicker({
  token,
  locale,
  companyId,
  bookingId,
  slots,
  mode,
}: {
  token: string;
  locale: string;
  companyId: string;
  bookingId?: string;
  slots: PickableSlot[];
  mode: 'book' | 'move';
}) {
  const t = useTranslations('interviews');
  const refusal = useRefusal();
  const [open, setOpen] = useState(mode === 'book');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    mode === 'book' ? bookAction : moveAction,
    { ok: false },
  );

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t('student.move')}
      </Button>
    );
  }

  const days = [...new Set(slots.map((s) => s.day))];
  const error = refusal(state);

  return (
    <form action={formAction} className="w-full space-y-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="company_id" value={companyId} />
      {bookingId ? <input type="hidden" name="booking_id" value={bookingId} /> : null}

      <p className="text-sm font-medium">{mode === 'book' ? t('student.chooseTime') : t('student.chooseNewTime')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {days.map((day) => (
          <fieldset key={day} className="rounded-lg border border-line p-3">
            <legend className="px-1 text-xs font-medium text-ink-muted">{day}</legend>
            <div className="space-y-1.5">
              {slots
                .filter((s) => s.day === day)
                .map((slot) => (
                  <label key={slot.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="slot_id" value={slot.id} required className="accent-brand-600" />
                    <span className="ltr-nums">{slot.label}</span>
                  </label>
                ))}
            </div>
          </fieldset>
        ))}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {mode === 'book' ? t('student.book') : t('student.confirmMove')}
        </Button>
        {mode === 'move' ? (
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t('student.keep')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Cancel, behind one extra click and an optional reason. */
export function CancelForm({ token, locale, bookingId }: { token: string; locale: string; bookingId: string }) {
  const t = useTranslations('interviews');
  const refusal = useRefusal();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(cancelAction, {
    ok: false,
  });

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        {t('student.cancel')}
      </Button>
    );
  }

  const error = refusal(state);

  return (
    <form action={formAction} className="w-full space-y-2 rounded-lg border border-danger/30 p-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="booking_id" value={bookingId} />
      <p className="text-sm">{t('student.cancelSure')}</p>
      <Input name="reason" placeholder={t('bookings.reason')} aria-label={t('bookings.reason')} />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {t('student.cancelConfirm')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {t('student.keep')}
        </Button>
      </div>
    </form>
  );
}
