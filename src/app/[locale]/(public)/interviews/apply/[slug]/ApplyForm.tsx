'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { ApplicationQuestions, WhyFirstQuestion } from '@/components/ApplicationQuestions';
import { CompanyPicker, type PickerCompany } from '@/components/CompanyPicker';
import { Alert, Button, Input, Label } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import type { ApplyFields } from '@/lib/interviews/applyFields';
import { applyAction } from './actions';

/**
 * Name and email, the questions the edition chose to ask (managers set them
 * on the Applicants tab), the CV, and the companies. Company preferences are
 * chosen on cards (CompanyPicker), in the order they are tapped; a full
 * company stays on the grid, blurred, and cannot be chosen.
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
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(applyAction, {
    ok: false,
  });

  if (state.ok) {
    return (
      <div className="space-y-3">
        <Alert tone="ok">{state.data?.replaced === 'true' ? t('apply.updated') : t('apply.thanks')}</Alert>
        <p className="text-sm text-ink-muted">{t('apply.whatNext')}</p>
      </div>
    );
  }

  const errorText = state.error
    ? state.hint && t.has(`errors.${state.hint}`)
      ? t(`errors.${state.hint}`)
      : state.error
    : null;

  return (
    <form action={formAction} className="space-y-5">
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
        <ApplicationQuestions fields={fields} idPrefix="apply" />
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
