'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ApplicationQuestions, WhyFirstQuestion } from '@/components/ApplicationQuestions';
import { CompanyPicker, type PickerCompany } from '@/components/CompanyPicker';
import { Alert, Button, Input, Label } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import type { ApplyFields } from '@/lib/interviews/applyFields';
import { cvProblem } from '@/lib/interviews/cvLimits';
import { applyAction } from './actions';

/**
 * Name and email, the questions the edition chose to ask (managers set them
 * on the Applicants tab), the CV, and the companies. Company preferences are
 * chosen on cards (CompanyPicker), in the order they are tapped; a full
 * company stays on the grid, blurred, and cannot be chosen.
 *
 * Whatever goes wrong, the student keeps what they typed:
 * - The CV (PDF, size) and the companies are checked here before anything
 *   is sent. A CV too big for Vercel's request limit would otherwise never
 *   reach the server's check.
 * - The submit is sent from onSubmit rather than by the form's own action,
 *   because React resets a form after its action runs, refusals included.
 * - A request that fails outright (a dropped connection, a 413, a deploy
 *   while the page was open) becomes a translated message instead of
 *   Next's error page.
 */
export function ApplyForm({
  locale,
  editionId,
  maxPreferences,
  companies,
  fields,
}: {
  locale: string;
  editionId: string;
  maxPreferences: number;
  companies: PickerCompany[];
  fields: ApplyFields;
}) {
  const t = useTranslations('interviews');
  const tCommon = useTranslations('common');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (previous, formData) => {
      try {
        return await applyAction(previous, formData);
      } catch {
        return { ok: false, error: 'network', hint: 'network' };
      }
    },
    { ok: false },
  );
  // A problem found before sending; cleared on every new attempt.
  const [problem, setProblem] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // React sees the prevented event and leaves the form alone (no reset).
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const cv = formData.get('cv');
    const found =
      (cv instanceof File && cv.size > 0 ? cvProblem(cv) : null) ??
      (formData.getAll('preference').length === 0 ? 'no_preferences' : null);
    setProblem(found);
    if (found) return;
    startTransition(() => formAction(formData));
  };

  if (state.ok) {
    return (
      <div className="space-y-3">
        <Alert tone="ok">{state.data?.replaced === 'true' ? t('apply.updated') : t('apply.thanks')}</Alert>
        <p className="text-sm text-ink-muted">{t('apply.whatNext')}</p>
      </div>
    );
  }

  const hint = problem ?? state.hint;
  const errorText =
    problem || state.error ? (hint && t.has(`errors.${hint}`) ? t(`errors.${hint}`) : (state.error ?? null)) : null;

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="edition_id" value={editionId} />
      <input type="hidden" name="locale" value={locale} />
      {/* A field no person sees; anything in it means a bot filled the form. */}
      <div className="hidden" aria-hidden="true">
        <label>
          Website <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">{t('apply.aboutYou')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="apply-name">{t('apply.name')}</Label>
            <Input id="apply-name" name="name" required autoComplete="name" />
          </div>
          <div>
            <Label htmlFor="apply-email">{t('apply.email')}</Label>
            <Input id="apply-email" name="email" type="email" dir="ltr" required autoComplete="email" />
            <p className="mt-1 text-xs text-ink-muted">{t('apply.emailHint')}</p>
          </div>
        </div>
        <ApplicationQuestions fields={fields} idPrefix="apply" clubMemberLabel="apply.clubMember" />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">{t('apply.cv')}</legend>
        <div>
          <Label htmlFor="apply-cv">{t('apply.cvFile')}</Label>
          <Input id="apply-cv" name="cv" type="file" accept="application/pdf,.pdf" required />
          <p className="mt-1 text-xs text-ink-muted">{t('apply.cvHint')}</p>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">{t('apply.companies')}</legend>
        <p className="text-xs text-ink-muted">{t('apply.companiesHint', { max: maxPreferences })}</p>
        <CompanyPicker companies={companies} max={maxPreferences} />
        <WhyFirstQuestion fields={fields} idPrefix="apply" />
      </fieldset>

      {errorText ? <Alert tone="danger">{errorText}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? tCommon('loading') : t('apply.submit')}
      </Button>
    </form>
  );
}
