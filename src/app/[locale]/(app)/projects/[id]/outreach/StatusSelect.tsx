'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { OUTREACH_STATUSES, type OutreachStatus } from '@/lib/outreach/types';
import { setTargetStatusAction } from './actions';

/**
 * A target's status as a select that saves the moment it changes — the
 * gesture the sheet's dropdown column trained everyone on. The database
 * logs the change with who made it (outreach_status_history).
 */
export function StatusSelect({
  targetId,
  projectId,
  locale,
  status,
  disabled,
}: {
  targetId: string;
  projectId: string;
  locale: string;
  status: OutreachStatus;
  disabled: boolean;
}) {
  const t = useTranslations('outreach');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    setTargetStatusAction,
    { ok: false },
  );

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="target_id" value={targetId} />
      <Select
        name="status"
        defaultValue={status}
        disabled={disabled || pending}
        aria-label={t('status')}
        className="min-w-40 py-1 text-xs"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {OUTREACH_STATUSES.map((value) => (
          <option key={value} value={value}>
            {t(`statuses.${value}`)}
          </option>
        ))}
      </Select>
      {state.error ? <p className="mt-1 text-xs text-danger">{state.error}</p> : null}
    </form>
  );
}
