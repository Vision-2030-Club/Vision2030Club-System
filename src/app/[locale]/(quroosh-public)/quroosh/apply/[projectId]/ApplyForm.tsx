'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label, Select, Textarea } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import {
  FUNDING_NONE,
  MAX_MEMBERS,
  MAX_WANTS,
  SECTIONS,
  normalizeSaudiMobile,
  type Question,
} from '@/lib/quroosh/questions';
import { applyAction } from './actions';

type Member = { key: number };

/**
 * The Quroosh application form, drawn from SECTIONS (src/lib/quroosh/questions.ts).
 *
 * As on the Mock Interviews form, whatever goes wrong the founder keeps what
 * they typed: the submit is sent from onSubmit rather than by the form's own
 * action (React resets a form after its action runs, refusals included), and
 * a request that fails outright becomes a translated message.
 *
 * Checked here before sending, so the message can name the field: the phone
 * numbers, at least one team member when the answer is "yes", the funding
 * and "what you want" choices. Everything is checked again by the database.
 */
export function ApplyForm({ projectId, privacyUrl }: { projectId: string; privacyUrl: string | null }) {
  const t = useTranslations('quroosh.apply');
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
  const [problem, setProblem] = useState<string | null>(null);
  const [hasTeam, setHasTeam] = useState<boolean | null>(null);
  const [members, setMembers] = useState<Member[]>([{ key: 0 }]);
  const [nextKey, setNextKey] = useState(1);
  const [funding, setFunding] = useState<string[]>([]);
  const [wants, setWants] = useState<string[]>([]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    const phones = [formData.get('phone'), ...formData.getAll('member_phone')].map((v) => String(v ?? ''));
    let found: string | null = null;
    if (phones.some((phone) => phone.trim() !== '' && normalizeSaudiMobile(phone) === null)) found = 'phone_invalid';
    else if (Number(formData.get('attendees')) > 1 + (hasTeam ? formData.getAll('member_name').length : 0))
      found = 'attendees_too_many';
    else if (funding.length === 0) found = 'funding_missing';
    else if (wants.length === 0) found = 'wants_missing';
    setProblem(found);
    if (found) return;
    startTransition(() => formAction(formData));
  };

  if (state.ok) {
    return (
      <div className="space-y-3">
        <Alert tone="ok">{t('thanks')}</Alert>
        <p className="text-sm text-ink-muted">{t('whatNext')}</p>
      </div>
    );
  }

  const hint = problem ?? state.hint;
  const errorText =
    problem || state.error ? (hint && t.has(`errors.${hint}`) ? t(`errors.${hint}`) : (state.error ?? null)) : null;

  const toggleFunding = (value: string, checked: boolean) =>
    setFunding((current) => {
      if (!checked) return current.filter((v) => v !== value);
      // "We have not raised" excludes every other answer, and the reverse.
      if (value === FUNDING_NONE) return [FUNDING_NONE];
      return [...current.filter((v) => v !== FUNDING_NONE), value];
    });
  const toggleWant = (value: string, checked: boolean) =>
    setWants((current) => (checked ? [...current, value].slice(0, MAX_WANTS) : current.filter((v) => v !== value)));

  const label = (question: Question) => (
    <>
      {t(`q.${question.name}`)}
      {question.required ? (
        <span className="text-danger" aria-hidden="true">
          {' *'}
        </span>
      ) : (
        <span className="text-ink-muted"> {t('optional')}</span>
      )}
    </>
  );
  const help = (name: string) =>
    t.has(`hint.${name}`) ? <p className="mt-1 text-xs text-ink-muted">{t(`hint.${name}`)}</p> : null;

  const field = (question: Question) => {
    const { name, kind, required, options = [], max } = question;
    const id = `q-${name}`;

    if (kind === 'radio' || kind === 'yesno') {
      const values = kind === 'yesno' ? ['yes', 'no'] : options;
      return (
        <fieldset key={name}>
          <legend className="text-sm font-medium text-ink">{label(question)}</legend>
          {help(name)}
          <div className="mt-2 space-y-2">
            {values.map((value) => (
              <label key={value} className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name={name}
                  value={value}
                  required={required}
                  className="mt-1 accent-brand-600"
                  onChange={name === 'has_team' ? () => setHasTeam(value === 'yes') : undefined}
                />
                <span>{t(`options.${name}.${value}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    if (kind === 'checkboxes') {
      const chosen = name === 'funding' ? funding : wants;
      const toggle = name === 'funding' ? toggleFunding : toggleWant;
      return (
        <fieldset key={name}>
          <legend className="text-sm font-medium text-ink">{label(question)}</legend>
          {help(name)}
          <div className="mt-2 space-y-2">
            {options.map((value) => {
              const full = name === 'wants' && chosen.length >= MAX_WANTS && !chosen.includes(value);
              return (
                <label key={value} className={`flex items-start gap-2 text-sm ${full ? 'text-ink-muted' : 'text-ink'}`}>
                  <input
                    type="checkbox"
                    name={name}
                    value={value}
                    checked={chosen.includes(value)}
                    disabled={full}
                    onChange={(event) => toggle(value, event.target.checked)}
                    className="mt-1 accent-brand-600"
                  />
                  <span>{t(`options.${name}.${value}`)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      );
    }

    if (kind === 'consent') {
      return (
        <div key={name}>
          <p className="text-sm font-medium text-ink">{label(question)}</p>
          <label className="mt-2 flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" name={name} required className="mt-1 accent-brand-600" />
            <span>
              {t(`consent.${name}`)}
              {name === 'data_consent' && privacyUrl ? (
                <>
                  {' '}
                  <a href={privacyUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                    {t('privacyLink')}
                  </a>
                </>
              ) : null}
            </span>
          </label>
        </div>
      );
    }

    if (kind === 'select') {
      return (
        <div key={name}>
          <Label htmlFor={id}>{label(question)}</Label>
          <Select id={id} name={name} required={required} defaultValue="">
            <option value="" disabled>
              {t('choose')}
            </option>
            {options.map((value) => (
              <option key={value} value={value}>
                {t(`options.${name}.${value}`)}
              </option>
            ))}
          </Select>
          {help(name)}
        </div>
      );
    }

    if (kind === 'number') {
      return (
        <div key={name}>
          <Label htmlFor={id}>{label(question)}</Label>
          <Input
            id={id}
            name={name}
            type="number"
            inputMode="numeric"
            min={question.min}
            max={question.max}
            step={1}
            dir="ltr"
            required={required}
            className="w-28"
          />
          {help(name)}
        </div>
      );
    }

    if (kind === 'textarea') {
      return (
        <div key={name}>
          <Label htmlFor={id}>{label(question)}</Label>
          <Textarea id={id} name={name} required={required} maxLength={max} rows={4} />
          {help(name)}
        </div>
      );
    }

    const ltr = kind === 'email' || kind === 'tel' || kind === 'url';
    return (
      <div key={name}>
        <Label htmlFor={id}>{label(question)}</Label>
        <Input
          id={id}
          name={name}
          type={kind === 'tel' ? 'tel' : kind}
          inputMode={kind === 'tel' ? 'tel' : undefined}
          placeholder={kind === 'tel' ? '05XXXXXXXX' : undefined}
          dir={ltr ? 'ltr' : undefined}
          required={required}
          maxLength={max}
          autoComplete={name === 'founder_name' ? 'name' : name === 'email' ? 'email' : name === 'phone' ? 'tel' : undefined}
        />
        {help(name)}
      </div>
    );
  };

  const teamMembers =
    hasTeam === true ? (
      <div className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
        <p className="text-sm text-ink-muted">{t('membersIntro')}</p>
        {members.map((member, index) => (
          <div key={member.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink">{t('memberN', { n: index + 1 })}</p>
              {members.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setMembers((current) => current.filter((m) => m.key !== member.key))}
                >
                  {t('removeMember')}
                </Button>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <Label htmlFor={`m-${member.key}-name`}>{t('memberName')}</Label>
                <Input id={`m-${member.key}-name`} name="member_name" required maxLength={200} />
              </div>
              <div>
                <Label htmlFor={`m-${member.key}-phone`}>{t('memberPhone')}</Label>
                <Input
                  id={`m-${member.key}-phone`}
                  name="member_phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="05XXXXXXXX"
                  dir="ltr"
                  required
                />
              </div>
              <div>
                <Label htmlFor={`m-${member.key}-email`}>{t('memberEmail')}</Label>
                <Input id={`m-${member.key}-email`} name="member_email" type="email" dir="ltr" required maxLength={320} />
              </div>
            </div>
          </div>
        ))}
        {members.length < MAX_MEMBERS ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setMembers((current) => [...current, { key: nextKey }]);
              setNextKey((k) => k + 1);
            }}
          >
            {t('addMember')}
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="hidden" aria-hidden="true">
        <label>
          Website <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {SECTIONS.map((section) => (
        <fieldset key={section.key} className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-sm">
          <legend className="px-1 text-base font-semibold text-brand-700">{t(`sections.${section.key}`)}</legend>
          {section.questions.map((question) => (
            <div key={question.name} className="space-y-3">
              {field(question)}
              {question.name === 'has_team' ? teamMembers : null}
            </div>
          ))}
        </fieldset>
      ))}

      {errorText ? <Alert tone="danger">{errorText}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? tCommon('loading') : t('submit')}
      </Button>
    </form>
  );
}
