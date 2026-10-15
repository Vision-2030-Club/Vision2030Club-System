'use client';

import { startTransition, useActionState, useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ApplicationQuestions, WhyFirstQuestion } from '@/components/ApplicationQuestions';
import { CompanyPicker, type PickerCompany } from '@/components/CompanyPicker';
import { Alert, Button, Input, Label } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import type { ActionResult } from '@/lib/actions';
import type { ApplyFields } from '@/lib/interviews/applyFields';
import { cvProblem } from '@/lib/interviews/cvLimits';
import { walkinAction } from './actions';

/**
 * The walk-in form: the apply form's questions and CV, and ONE company,
 * chosen from today's companies (a company with no free time left today is
 * shown blurred and cannot be chosen). Kept like ApplyForm: checked here
 * before sending, sent from onSubmit so a refusal never clears what was
 * typed, and a failed request becomes a sentence. On success the student is
 * taken to their status page, which shows their number and, once reception
 * confirms, their room and time.
 */
export function WalkinForm({
  token,
  locale,
  companies,
  fields,
}: {
  token: string;
  locale: string;
  companies: PickerCompany[];
  fields: ApplyFields;
}) {
  const t = useTranslations('interviews');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (previous, formData) => {
      try {
        return await walkinAction(previous, formData);
      } catch {
        return { ok: false, error: 'network', hint: 'network' };
      }
    },
    { ok: false },
  );
  const [problem, setProblem] = useState<string | null>(null);

  const request = state.ok ? state.data?.request : undefined;
  useEffect(() => {
    if (request) router.replace(`/interviews/walkin/${request}`);
  }, [request, router]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    const cv = formData.get('cv');
    const found =
      (cv instanceof File && cv.size > 0 ? cvProblem(cv) : null) ??
      (formData.getAll('preference').length === 0 ? 'no_preferences' : null);
    setProblem(found);
    if (found) return;
    startTransition(() => formAction(formData));
  };

  if (state.ok) {
    return <Alert tone="ok">{t('walkinForm.sent')}</Alert>;
  }

  const hint = problem ?? state.hint;
  const errorText =
    problem || state.error ? (hint && t.has(`errors.${hint}`) ? t(`errors.${hint}`) : (state.error ?? null)) : null;

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      {/* A field no person sees; anything in it means a bot filled the form. */}
      <div className="hidden" aria-hidden="true">
        <label>
          Website <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">{t('walkinForm.company')}</legend>
        <p className="text-xs text-ink-muted">{t('walkinForm.companyHint')}</p>
        <CompanyPicker companies={companies} max={1} />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">{t('apply.aboutYou')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="walkin-name">{t('apply.name')}</Label>
            <Input id="walkin-name" name="name" required autoComplete="name" />
          </div>
          <div>
            <Label htmlFor="walkin-email">{t('apply.email')}</Label>
            <Input id="walkin-email" name="email" type="email" dir="ltr" required autoComplete="email" />
          </div>
        </div>
        <ApplicationQuestions fields={fields} idPrefix="walkin" clubMemberLabel="apply.clubMember" />
        <WhyFirstQuestion fields={fields} idPrefix="walkin" />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">{t('apply.cv')}</legend>
        <div>
          <Label htmlFor="walkin-cv">{t('apply.cvFile')}</Label>
          <Input id="walkin-cv" name="cv" type="file" accept="application/pdf,.pdf" required />
          <p className="mt-1 text-xs text-ink-muted">{t('apply.cvHint')}</p>
        </div>
      </fieldset>

      {errorText ? <Alert tone="danger">{errorText}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? tCommon('loading') : t('walkinForm.submit')}
      </Button>
    </form>
  );
}
