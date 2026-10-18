'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label, Textarea, cx } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { visitorFeedbackAction } from './actions';

// Kept in step with VISITOR_QUESTIONS / VISITOR_SCALE (visitorFeedback.ts, server-only).
const QUESTIONS = ['event_quality', 'club_goals', 'activities', 'team'] as const;
const SCALE = [4, 3, 2, 1] as const;

/** Phone, four questions on a four-step scale, an optional comment. */
export function VisitorFeedbackForm({ slug, locale }: { slug: string; locale: string }) {
  const t = useTranslations('interviews');
  const tCommon = useTranslations('common');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (previous, formData) => {
      try {
        return await visitorFeedbackAction(previous, formData);
      } catch {
        return { ok: false, error: 'network', hint: 'generic' };
      }
    },
    { ok: false },
  );

  if (state.ok) {
    return <Alert tone="ok">{state.message === 'replaced' ? t('visitorFeedback.replaced') : t('visitorFeedback.thanks')}</Alert>;
  }

  const errorText = state.error
    ? state.hint && t.has(`errors.${state.hint}`)
      ? t(`errors.${state.hint}`)
      : state.error
    : null;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      {/* A field no person sees; anything in it means a bot filled the form. */}
      <div className="hidden" aria-hidden="true">
        <input name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <Label htmlFor="phone">{t('visitorFeedback.phone')}</Label>
        <Input id="phone" name="phone" type="tel" dir="ltr" required autoComplete="tel" placeholder="05xxxxxxxx" />
        <p className="mt-1 text-xs text-ink-muted">{t('visitorFeedback.phoneHint')}</p>
      </div>

      {QUESTIONS.map((q) => (
        <fieldset key={q}>
          <legend className="mb-2 text-sm font-medium">{t(`visitorFeedback.q.${q}`)}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SCALE.map((n) => (
              <label
                key={n}
                className={cx(
                  'flex h-10 cursor-pointer items-center justify-center rounded-lg border px-2 text-sm',
                  'has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:font-semibold has-[:checked]:text-brand-700',
                  'border-line text-ink-muted',
                )}
              >
                <input type="radio" name={q} value={n} required className="sr-only" />
                {t(`visitorFeedback.scale.${n}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div>
        <Label htmlFor="comment">{t('visitorFeedback.comment')}</Label>
        <Textarea id="comment" name="comment" rows={3} />
      </div>

      {errorText ? <Alert tone="danger">{errorText}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? tCommon('loading') : t('visitorFeedback.submit')}
      </Button>
    </form>
  );
}
