'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, cx } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { sessionCheckInAction } from '../actions';

const STAR_PATH =
  'M12 2.75l2.83 5.73 6.32.92-4.57 4.46 1.08 6.29L12 17.17l-5.66 2.98 1.08-6.29L2.85 9.4l6.32-.92L12 2.75z';

/** One star, filled or outlined, in the theme's purple. */
export function Star({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cx(filled ? 'text-brand-600' : 'text-brand-200', className)}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
    >
      <path d={STAR_PATH} />
    </svg>
  );
}

/** A rating already given, read only. */
export function StarsShown({ rating, label }: { rating: number; label: string }) {
  return (
    <div className="flex justify-center gap-1" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} filled={n <= rating} className="size-7" />
      ))}
    </div>
  );
}

/**
 * The five stars and "تسجيل حضور". The stars are radio buttons, so they work
 * from a keyboard and a screen reader; the button stays disabled until one
 * is chosen. On success the action reloads the page with the confirmation.
 */
export function RatingForm({
  locale,
  projectId,
  labels,
}: {
  locale: string;
  projectId: string;
  labels: { question: string; star: string[]; pick: string; submit: string; sending: string };
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(sessionCheckInAction, { ok: false });
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const shown = hover || rating;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="project_id" value={projectId} />

      <fieldset className="space-y-3">
        <legend className="mb-3 w-full text-center text-base font-semibold text-ink">{labels.question}</legend>
        {/* Stars always run 1 → 5 from the start of the line: right to left in Arabic. */}
        <div className="flex justify-center gap-1 sm:gap-2" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="cursor-pointer rounded-lg p-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600"
              onMouseEnter={() => setHover(n)}
            >
              <input
                type="radio"
                name="rating"
                value={n}
                required
                checked={rating === n}
                onChange={() => setRating(n)}
                className="sr-only"
              />
              <span className="sr-only">{labels.star[n - 1]}</span>
              <Star filled={n <= shown} className="size-10 transition-transform hover:scale-110 sm:size-12" />
            </label>
          ))}
        </div>
        <p className="min-h-5 text-center text-sm text-ink-muted" aria-live="polite">
          {shown ? labels.star[shown - 1] : labels.pick}
        </p>
      </fieldset>

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Button type="submit" disabled={pending || rating === 0} className="w-full min-h-12 text-base">
        {pending ? labels.sending : labels.submit}
      </Button>
    </form>
  );
}
