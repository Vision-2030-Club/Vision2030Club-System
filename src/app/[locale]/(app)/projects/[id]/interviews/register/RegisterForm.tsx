'use client';

import { useActionState, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ApplicationQuestions, WhyFirstQuestion } from '@/components/ApplicationQuestions';
import { CompanyPicker, type PickerCompany } from '@/components/CompanyPicker';
import { Alert, Button, Input, Label, cx } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import type { ApplyFields } from '@/lib/interviews/applyFields';
import { registerAction } from '../actions';

/**
 * The Register tab's form. Remounted with a new key after a success, so
 * "Register another" starts from an empty form rather than the last student.
 */
export function RegisterForm(props: {
  locale: string;
  projectId: string;
  maxPreferences: number;
  companies: PickerCompany[];
  fields: ApplyFields;
}) {
  const [round, setRound] = useState(0);
  return <Form key={round} {...props} onAnother={() => setRound((n) => n + 1)} />;
}

function Form({
  locale,
  projectId,
  maxPreferences,
  companies,
  fields,
  onAnother,
}: {
  locale: string;
  projectId: string;
  maxPreferences: number;
  companies: PickerCompany[];
  fields: ApplyFields;
  onAnother: () => void;
}) {
  const t = useTranslations('interviews');
  const tCommon = useTranslations('common');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(registerAction, { ok: false });

  if (state.ok) {
    return (
      <div className="space-y-3">
        <Alert tone="ok">{state.data?.replaced === 'true' ? t('register.updated') : t('register.done')}</Alert>
        <Button type="button" variant="secondary" onClick={onAnother}>
          {t('register.another')}
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="locale" value={locale} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="register-name">{t('register.fullName')}</Label>
          <Input id="register-name" name="name" required autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="register-email">{t('applicants.email')}</Label>
          <Input id="register-email" name="email" type="email" dir="ltr" required autoComplete="off" />
        </div>
      </div>
      <ApplicationQuestions fields={fields} idPrefix="register" />

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-ink">{t('register.companies')}</legend>
        <p className="text-xs text-ink-muted">{t('register.companiesHint', { max: maxPreferences })}</p>
        {companies.length ? (
          <CompanyPicker companies={companies} max={maxPreferences} />
        ) : (
          <p className="text-sm text-ink-muted">{t('register.noCompanies')}</p>
        )}
        <WhyFirstQuestion fields={fields} idPrefix="register" />
      </fieldset>

      <CvDropzone />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? tCommon('loading') : t('register.submit')}
      </Button>
    </form>
  );
}

/**
 * A file input dressed as a drop target. Dropping a file puts it in the real
 * input, so the form posts it like any other field; the PDF and 5 MB rules
 * are checked on the server. Not `required`: the database asks for a CV on a
 * new registration (missing_cv) and keeps the old one on an update.
 */
function CvDropzone() {
  const t = useTranslations('interviews');
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    const files = event.dataTransfer.files;
    if (!input.current || files.length === 0) return;
    input.current.files = files;
    setFileName(files[0].name);
  };

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-ink">{t('register.cv')}</span>
      <label
        htmlFor="register-cv"
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cx(
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm',
          'transition-[background-color,border-color] duration-150',
          over ? 'border-brand-600 bg-brand-50' : 'border-line hover:bg-surface-muted',
        )}
      >
        <span className="font-medium text-ink">{fileName ?? t('register.cvDrop')}</span>
        <span className="text-xs text-ink-muted">{t('register.cvHint')}</span>
      </label>
      <input
        ref={input}
        id="register-cv"
        name="cv"
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
      />
    </div>
  );
}
