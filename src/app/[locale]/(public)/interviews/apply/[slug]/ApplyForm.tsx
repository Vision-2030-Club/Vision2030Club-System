'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label, Select, Textarea } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { ENGLISH_LEVELS, LEVELS, UNIVERSITIES } from '@/lib/interviews/types';
import { applyAction } from './actions';

export type ApplyCompany = {
  id: string;
  name: string;
  description: string;
  logo_url: string | null;
};

/**
 * The same questions as last year's form. Company preferences are ordered
 * choices — first, second, third… — each a select that hides what the others
 * already took, which is the simplest thing that survives a phone screen.
 */
export function ApplyForm({
  locale,
  editionId,
  maxPreferences,
  companies,
}: {
  locale: string;
  editionId: string;
  maxPreferences: number;
  companies: ApplyCompany[];
}) {
  const t = useTranslations('interviews');
  const tCommon = useTranslations('common');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(applyAction, {
    ok: false,
  });
  const [choices, setChoices] = useState<string[]>(Array(maxPreferences).fill(''));
  const [university, setUniversity] = useState<string>('');

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

  const setChoice = (index: number, value: string) =>
    setChoices((prev) => prev.map((v, i) => (i === index ? value : v)));

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
          <div className="sm:col-span-2">
            <Label htmlFor="name">{t('applicants.name')}</Label>
            <Input id="name" name="name" required autoComplete="name" />
          </div>
          <div>
            <Label htmlFor="email">{t('applicants.email')}</Label>
            <Input id="email" name="email" type="email" dir="ltr" required autoComplete="email" />
            <p className="mt-1 text-xs text-ink-muted">{t('apply.emailHint')}</p>
          </div>
          <div>
            <Label htmlFor="phone">{t('applicants.phone')}</Label>
            <Input id="phone" name="phone" type="tel" dir="ltr" required autoComplete="tel" placeholder="05xxxxxxxx" />
          </div>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-ink">{t('applicants.clubMember')}</span>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="is_club_member" value="yes" className="accent-brand-600" />
                {tCommon('yes')}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="is_club_member" value="no" defaultChecked className="accent-brand-600" />
                {tCommon('no')}
              </label>
            </div>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">{t('apply.studies')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="university">{t('applicants.university')}</Label>
            <Select id="university" name="university" required value={university} onChange={(e) => setUniversity(e.target.value)}>
              <option value="">{t('apply.choose')}</option>
              {UNIVERSITIES.map((key) => (
                <option key={key} value={key}>
                  {t(`universities.${key}`)}
                </option>
              ))}
            </Select>
          </div>
          {university === 'other' ? (
            <div>
              <Label htmlFor="university_other">{t('apply.universityOther')}</Label>
              <Input id="university_other" name="university_other" required />
            </div>
          ) : null}
          <div>
            <Label htmlFor="level">{t('applicants.level')}</Label>
            <Select id="level" name="level" required defaultValue="">
              <option value="">{t('apply.choose')}</option>
              {LEVELS.map((key) => (
                <option key={key} value={key}>
                  {t(`levels.${key}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="college">{t('applicants.college')}</Label>
            <Input id="college" name="college" required />
          </div>
          <div>
            <Label htmlFor="major">{t('applicants.major')}</Label>
            <Input id="major" name="major" required />
          </div>
          <div>
            <Label htmlFor="gpa">{t('applicants.gpa')}</Label>
            <Input id="gpa" name="gpa" dir="ltr" inputMode="decimal" placeholder="4.5" />
          </div>
          <div>
            <Label htmlFor="english_level">{t('applicants.english')}</Label>
            <Select id="english_level" name="english_level" required defaultValue="">
              <option value="">{t('apply.choose')}</option>
              {ENGLISH_LEVELS.map((key) => (
                <option key={key} value={key}>
                  {t(`english.${key}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">{t('apply.cv')}</legend>
        <div>
          <Label htmlFor="cv">{t('apply.cvFile')}</Label>
          <Input id="cv" name="cv" type="file" accept="application/pdf,.pdf" required />
          <p className="mt-1 text-xs text-ink-muted">{t('apply.cvHint')}</p>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">{t('apply.companies')}</legend>
        <p className="text-xs text-ink-muted">{t('apply.companiesHint', { max: maxPreferences })}</p>
        {choices.map((choice, index) => (
          <div key={index}>
            <Label htmlFor={`preference-${index}`}>{t('apply.choiceN', { n: index + 1 })}</Label>
            <Select
              id={`preference-${index}`}
              name="preference"
              value={choice}
              onChange={(e) => setChoice(index, e.target.value)}
              required={index === 0}
            >
              <option value="">{index === 0 ? t('apply.choose') : t('apply.none')}</option>
              {companies.map((company) => (
                <option
                  key={company.id}
                  value={company.id}
                  disabled={choices.includes(company.id) && choice !== company.id}
                >
                  {company.name}
                </option>
              ))}
            </Select>
          </div>
        ))}
        <ul className="grid gap-2 sm:grid-cols-2">
          {companies.map((company) => (
            <li key={company.id} className="flex gap-3 rounded-lg border border-line p-3 text-xs">
              {company.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logo_url} alt="" width={40} height={40} className="size-10 shrink-0 rounded bg-white object-contain" />
              ) : null}
              <div className="min-w-0">
                <div className="font-semibold text-ink">{company.name}</div>
                {company.description ? <p className="mt-0.5 text-ink-muted">{company.description}</p> : null}
              </div>
            </li>
          ))}
        </ul>
        <div>
          <Label htmlFor="why_first">{t('apply.whyFirst')}</Label>
          <Textarea id="why_first" name="why_first" rows={4} required maxLength={2000} />
        </div>
      </fieldset>

      {errorText ? <Alert tone="danger">{errorText}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? tCommon('loading') : t('apply.submit')}
      </Button>
    </form>
  );
}
