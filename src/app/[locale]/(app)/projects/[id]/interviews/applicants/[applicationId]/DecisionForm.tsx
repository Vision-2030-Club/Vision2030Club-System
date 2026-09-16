'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import type { Decision } from '@/lib/interviews/types';
import { decideAction } from '../../actions';

/**
 * Accept, reject, or put back to pending — for ONE company of one student.
 * Three submit buttons on one form, so the note travels with whichever was
 * pressed. The decision is independent of the student's other companies
 * (0001: decide_preference touches one row).
 */
export function DecisionForm({
  locale,
  projectId,
  applicationId,
  companyId,
  current,
}: {
  locale: string;
  projectId: string;
  applicationId: string;
  companyId: string;
  current: Decision;
}) {
  const t = useTranslations('interviews');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(decideAction, {
    ok: false,
  });

  return (
    <form action={formAction} className="mt-2 space-y-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="company_id" value={companyId} />

      <Input name="note" placeholder={t('applicants.notePlaceholder')} aria-label={t('applicants.notePlaceholder')} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="accepted" disabled={pending || current === 'accepted'} className="px-3 py-1.5">
          {t('applicants.accept')}
        </Button>
        <Button type="submit" name="decision" value="rejected" variant="danger" disabled={pending || current === 'rejected'} className="px-3 py-1.5">
          {t('applicants.reject')}
        </Button>
        <Button type="submit" name="decision" value="pending" variant="secondary" disabled={pending || current === 'pending'} className="px-3 py-1.5">
          {t('applicants.undecide')}
        </Button>
      </div>
    </form>
  );
}
