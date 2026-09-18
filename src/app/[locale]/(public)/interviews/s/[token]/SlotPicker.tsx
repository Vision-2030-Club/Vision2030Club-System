'use client';

import { useActionState, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, cx } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { bookAction, cancelAction, moveAction } from './actions';

export type PickableSlot = {
  id: string;
  /** Grouping key for the day tabs — sorts correctly, unlike the display label. */
  day: string;
  dayLabel: string;
  timeLabel: string;
  taken: boolean;
};

function useRefusal() {
  const t = useTranslations('interviews');
  return (state: ActionResult) =>
    state.error
      ? state.hint && t.has(`errors.${state.hint}`)
        ? t(`errors.${state.hint}`)
        : state.error
      : null;
}

/**
 * One company's schedule: a day at a time (a tab per day), every slot shown
 * as its own rectangle — open ones pick-able, taken ones shown but greyed
 * and inert, so the day's shape is visible instead of just its gaps.
 */
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

  const days = useMemo(() => [...new Set(slots.map((s) => s.day))].sort(), [slots]);
  const [selectedDay, setSelectedDay] = useState(days[0]);
  const day = selectedDay && days.includes(selectedDay) ? selectedDay : days[0];
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t('student.move')}
      </Button>
    );
  }

  const error = refusal(state);
  const dayLabel = new Map(slots.map((s) => [s.day, s.dayLabel]));

  return (
    <form action={formAction} className="w-full space-y-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="slot_id" value={selectedSlotId ?? ''} />
      {bookingId ? <input type="hidden" name="booking_id" value={bookingId} /> : null}

      <p className="text-sm font-medium">{mode === 'book' ? t('student.chooseTime') : t('student.chooseNewTime')}</p>

      {days.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setSelectedDay(d)}
              className={cx(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                d === day
                  ? 'bg-brand-600 text-white'
                  : 'border border-line text-ink-muted hover:bg-surface-muted',
              )}
            >
              {dayLabel.get(d)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {slots
          .filter((s) => s.day === day)
          .map((slot) => {
            const selected = selectedSlotId === slot.id;
            return (
              <button
                key={slot.id}
                type="button"
                disabled={slot.taken}
                onClick={() => setSelectedSlotId(slot.id)}
                aria-pressed={selected}
                className={cx(
                  'ltr-nums rounded-lg border px-3 py-2.5 text-center text-sm font-medium transition-colors',
                  slot.taken
                    ? 'cursor-not-allowed border-line/60 bg-surface-muted text-ink-muted/40 line-through'
                    : selected
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-line text-ink hover:border-brand-400 hover:bg-brand-50',
                )}
              >
                {slot.timeLabel}
              </button>
            );
          })}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !selectedSlotId}>
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
