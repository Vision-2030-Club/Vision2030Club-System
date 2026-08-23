'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { RequestFields } from '@/components/RequestFields';
import { Alert, Button, Label, Textarea, cx } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import type { FieldOptions, RequestField } from '@/lib/requests';
import { transitionRequestAction } from '../actions';

export type AvailableTransition = {
  to_status: string;
  label_en: string;
  label_ar: string;
  /** Does this move end the request? Used only to colour the button. */
  is_terminal: boolean;
  is_approved: boolean;
  /** Questions this particular move asks (migration 0033). */
  field_schema: RequestField[];
};

/**
 * The buttons here come from `request_transitions` — whatever rows exist for
 * the current status, filtered to the ones this person is allowed to perform.
 * Nothing is hardcoded, which is why the Counter loop appears simply because
 * the configuration says `countered_by_target -> countered_by_requester` and
 * back again, with no cap on how many rounds that takes.
 *
 * A move that asks for nothing submits straight away. A move that carries a
 * `field_schema` opens a dialog with those questions first — which is how a
 * counter-offer collects a new time, a room and a format without this file
 * knowing what a meeting is. It used to: there was a branch here that drew two
 * date inputs whenever a type had a field called `proposed_start`.
 */
export function RequestActions({
  requestId,
  transitions,
  fieldOptions,
}: {
  requestId: string;
  transitions: AvailableTransition[];
  /** For fields whose choices come from a table, e.g. the room picker. */
  fieldOptions: FieldOptions;
}) {
  const locale = useLocale();
  const t = useTranslations('requests');
  const [asking, setAsking] = useState<AvailableTransition | null>(null);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    transitionRequestAction,
    { ok: false },
  );

  if (transitions.length === 0) {
    return <p className="text-sm text-ink-muted">{t('noActions')}</p>;
  }

  const label = (transition: AvailableTransition) =>
    locale === 'ar' ? transition.label_ar : transition.label_en;

  const tone = (transition: AvailableTransition) =>
    transition.is_approved ? 'primary' : transition.is_terminal ? 'danger' : 'secondary';

  return (
    <>
      {/* Moves that ask nothing: one form, one click. */}
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="request_id" value={requestId} />

        <div>
          <Label htmlFor="note">{t('noteOptional')}</Label>
          <Textarea id="note" name="note" rows={2} />
        </div>

        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {state.ok ? <Alert tone="ok">{t('transitioned')}</Alert> : null}

        <div className="flex flex-wrap gap-2">
          {transitions.map((transition) =>
            transition.field_schema.length === 0 ? (
              <Button
                key={transition.to_status}
                type="submit"
                name="to_status"
                value={transition.to_status}
                disabled={pending}
                variant={tone(transition)}
              >
                {label(transition)}
              </Button>
            ) : (
              <Button
                key={transition.to_status}
                type="button"
                onClick={() => setAsking(transition)}
                disabled={pending}
                variant={tone(transition)}
              >
                {label(transition)}…
              </Button>
            ),
          )}
        </div>
      </form>

      {asking ? (
        <TransitionDialog
          requestId={requestId}
          transition={asking}
          fieldOptions={fieldOptions}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </>
  );
}

function TransitionDialog({
  requestId,
  transition,
  fieldOptions,
  onClose,
}: {
  requestId: string;
  transition: AvailableTransition;
  fieldOptions: FieldOptions;
  onClose: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations('requests');
  const tCommon = useTranslations('common');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    transitionRequestAction,
    { ok: false },
  );

  // Once the move succeeds the request is in a different status, so the
  // questions this dialog is asking no longer apply to it.
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className={cx(
        // `m-auto` is load-bearing: Tailwind's preflight zeroes the margin a
        // modal <dialog> relies on to centre itself.
        'm-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0',
        'text-ink shadow-lg backdrop:bg-ink/40',
      )}
    >
      <form action={formAction} className="space-y-3 p-5">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="to_status" value={transition.to_status} />

        <h2 className="text-base font-semibold">
          {locale === 'ar' ? transition.label_ar : transition.label_en}
        </h2>

        <RequestFields fields={transition.field_schema} options={fieldOptions} />

        <div>
          <Label htmlFor="dialog_note">{t('noteOptional')}</Label>
          <Textarea id="dialog_note" name="note" rows={2} />
        </div>

        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {tCommon('confirm')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
