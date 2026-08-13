'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, Input, Label, Textarea } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { transitionRequestAction } from '../actions';

export type AvailableTransition = {
  to_status: string;
  label_en: string;
  label_ar: string;
  /** Does this move end the request? Used only to colour the button. */
  is_terminal: boolean;
  is_approved: boolean;
};

/**
 * The buttons here come from `request_transitions` — whatever rows exist for
 * the current status, filtered to the ones this person is allowed to perform.
 * Nothing is hardcoded, so the Counter loop appears simply because the
 * configuration says `countered_by_target -> countered_by_requester` and back
 * again, with no cap on how many rounds that takes.
 */
export function RequestActions({
  requestId,
  transitions,
  scheduling,
  proposedStart,
  proposedEnd,
}: {
  requestId: string;
  transitions: AvailableTransition[];
  /** True when the request type carries a proposed time (meeting requests). */
  scheduling: boolean;
  proposedStart?: string;
  proposedEnd?: string;
}) {
  const locale = useLocale();
  const t = useTranslations('requests');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    transitionRequestAction,
    { ok: false },
  );

  if (transitions.length === 0) {
    return <p className="text-sm text-ink-muted">{t('noActions')}</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="request_id" value={requestId} />

      <div>
        <Label htmlFor="note">{t('noteOptional')}</Label>
        <Textarea id="note" name="note" rows={2} />
      </div>

      {scheduling ? (
        <>
          <p className="text-xs text-ink-muted">{t('counterHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="proposed_start">{t('proposedStart')}</Label>
              <Input
                id="proposed_start"
                name="proposed_start"
                type="datetime-local"
                defaultValue={proposedStart}
              />
            </div>
            <div>
              <Label htmlFor="proposed_end">{t('proposedEnd')}</Label>
              <Input
                id="proposed_end"
                name="proposed_end"
                type="datetime-local"
                defaultValue={proposedEnd}
              />
            </div>
          </div>
        </>
      ) : null}

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="ok">{t('transitioned')}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {transitions.map((transition) => (
          <Button
            key={transition.to_status}
            type="submit"
            name="to_status"
            value={transition.to_status}
            disabled={pending}
            variant={
              transition.is_approved
                ? 'primary'
                : transition.is_terminal
                  ? 'danger'
                  : 'secondary'
            }
          >
            {locale === 'ar' ? transition.label_ar : transition.label_en}
          </Button>
        ))}
      </div>
    </form>
  );
}
