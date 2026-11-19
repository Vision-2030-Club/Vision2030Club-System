'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, cx } from '@/components/ui';
import { answerChallengeAction } from '../actions';

/**
 * One question of a challenge, with its countdown.
 *
 * The countdown here is only what the guest sees. The time that counts is
 * measured by the database from when it showed the question, so a paused
 * tab or a changed phone clock gains nothing. `remainingMs` is what the
 * server says was left when it rendered this page; when it reaches zero the
 * form sends itself with no choice.
 *
 * The page gives this component the question's id as its `key`, so each
 * question starts with a clean form.
 */
export function QuestionForm({
  locale,
  token,
  questionId,
  prompt,
  options,
  remainingMs,
  seconds,
  labels,
}: {
  locale: string;
  token: string;
  questionId: string;
  prompt: string;
  options: string[];
  remainingMs: number;
  seconds: number;
  labels: { next: string; timeLeft: string; timeUp: string; letters: string[] };
}) {
  const form = useRef<HTMLFormElement>(null);
  const sent = useRef(false);
  const [left, setLeft] = useState(remainingMs);
  const [choice, setChoice] = useState<number | null>(null);

  useEffect(() => {
    const end = Date.now() + remainingMs;
    const tick = () => {
      const now = Math.max(end - Date.now(), 0);
      setLeft(now);
      if (now === 0 && !sent.current) {
        sent.current = true;
        form.current?.requestSubmit();
      }
    };
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [remainingMs]);

  const over = left === 0;
  const shown = Math.ceil(left / 1000);

  return (
    <form
      ref={form}
      action={answerChallengeAction}
      onSubmit={() => {
        sent.current = true;
      }}
      className="space-y-5"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="question_id" value={questionId} />

      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-muted">{over ? labels.timeUp : labels.timeLeft}</span>
          <span
            className={cx('ltr-nums text-2xl font-bold tabular-nums', shown <= 5 ? 'text-danger' : 'text-ink')}
            dir="ltr"
            aria-live="off"
          >
            0:{String(shown).padStart(2, '0')}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cx('h-full rounded-full', shown <= 5 ? 'bg-danger' : 'bg-brand-600')}
            style={{ width: `${Math.min((left / (seconds * 1000)) * 100, 100)}%` }}
          />
        </div>
      </div>

      <h1 className="text-balance text-xl font-semibold leading-relaxed text-ink">{prompt}</h1>

      <fieldset className="space-y-3" disabled={over}>
        {options.map((option, index) => (
          <label
            key={index}
            className={cx(
              'flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-4 text-ink',
              choice === index ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface',
            )}
          >
            <input
              type="radio"
              name="choice"
              value={index}
              checked={choice === index}
              onChange={() => setChoice(index)}
              className="sr-only"
            />
            <span
              className={cx(
                'grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold',
                choice === index ? 'bg-brand-600 text-brand-50' : 'bg-surface-muted text-ink-muted',
              )}
            >
              {labels.letters[index]}
            </span>
            <span className="font-medium">{option}</span>
          </label>
        ))}
      </fieldset>

      <NextButton label={labels.next} disabled={choice === null || over} />
    </form>
  );
}

function NextButton({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} className="min-h-12 w-full text-base">
      {label}
    </Button>
  );
}
