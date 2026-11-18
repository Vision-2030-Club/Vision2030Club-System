'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import type { ActionResult } from '@/lib/actions';
import { checkInFromPassAction } from '@/app/[locale]/(app)/projects/[id]/event-attendance/actions';

/**
 * Shown on a pass only to a signed-in manager or HR member of that event:
 * one button that checks the pass's owner in for today. The server checks
 * again who is pressing it.
 */
export function StaffCheckIn({ projectId, locale, token }: { projectId: string; locale: string; token: string }) {
  const t = useTranslations('eventAttendance.pass.staff');
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(async (previous, formData) => {
    const result = await checkInFromPassAction(previous, formData);
    // The days attended, below, are the server's.
    if (result.ok) router.refresh();
    return result;
  }, { ok: false });

  const already = state.data?.result === 'already';

  return (
    <div className="space-y-3 rounded-xl border-2 border-brand-200 bg-brand-50 p-4">
      <p className="text-sm font-semibold text-brand-700">{t('title')}</p>
      {state.ok && state.data?.message ? (
        <Alert tone={already ? 'warn' : 'ok'}>{state.data.message}</Alert>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="token" value={token} />
          <Button type="submit" disabled={pending} className="w-full py-3 text-base">
            {t('checkIn')}
          </Button>
        </form>
      )}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
    </div>
  );
}
