'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input, Label, Select, Textarea } from '@/components/ui';
import type { ApplyFields } from '@/lib/interviews/applyFields';
import { ENGLISH_LEVELS, LEVELS, UNIVERSITIES } from '@/lib/interviews/types';

/**
 * The questions an edition chose to ask (lib/interviews/applyFields.ts),
 * between the always-asked name/email above and the CV and companies below.
 * Shared by the public apply form and the staff Register tab so both ask the
 * same thing. "Why your first choice?" is its own export because it reads
 * best after the companies.
 */
export function ApplicationQuestions({
  fields,
  idPrefix,
  clubMemberLabel = 'applicants.clubMember',
}: {
  fields: ApplyFields;
  idPrefix: string;
  /** The public form names the club in full; the team's register form keeps the short label. */
  clubMemberLabel?: string;
}) {
  const t = useTranslations('interviews');
  const tCommon = useTranslations('common');
  const [university, setUniversity] = useState('');
  const id = (name: string) => `${idPrefix}-${name}`;
  const asked = (field: keyof ApplyFields) => fields[field] !== 'off';
  const required = (field: keyof ApplyFields) => fields[field] === 'required';

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {asked('phone') ? (
        <div>
          <Label htmlFor={id('phone')}>{t('applicants.phone')}</Label>
          <Input
            id={id('phone')}
            name="phone"
            type="tel"
            dir="ltr"
            required={required('phone')}
            autoComplete="tel"
            placeholder="05xxxxxxxx"
          />
        </div>
      ) : null}
      {asked('university') ? (
        <div>
          <Label htmlFor={id('university')}>{t('applicants.university')}</Label>
          <Select
            id={id('university')}
            name="university"
            required={required('university')}
            value={university}
            onChange={(e) => setUniversity(e.target.value)}
          >
            <option value="">{t('apply.choose')}</option>
            {UNIVERSITIES.map((key) => (
              <option key={key} value={key}>
                {t(`universities.${key}`)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {asked('university') && university === 'other' ? (
        <div>
          <Label htmlFor={id('university_other')}>{t('apply.universityOther')}</Label>
          <Input id={id('university_other')} name="university_other" required />
        </div>
      ) : null}
      {asked('level') ? (
        <div>
          <Label htmlFor={id('level')}>{t('applicants.level')}</Label>
          <Select id={id('level')} name="level" required={required('level')} defaultValue="">
            <option value="">{t('apply.choose')}</option>
            {LEVELS.map((key) => (
              <option key={key} value={key}>
                {t(`levels.${key}`)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {asked('major') ? (
        <div>
          <Label htmlFor={id('major')}>{t('applicants.major')}</Label>
          <Input id={id('major')} name="major" required={required('major')} />
        </div>
      ) : null}
      {asked('college') ? (
        <div>
          <Label htmlFor={id('college')}>{t('applicants.college')}</Label>
          <Input id={id('college')} name="college" required={required('college')} />
        </div>
      ) : null}
      {asked('gpa') ? (
        <div>
          <Label htmlFor={id('gpa')}>{t('applicants.gpa')}</Label>
          <Input id={id('gpa')} name="gpa" dir="ltr" inputMode="decimal" placeholder="4.5" required={required('gpa')} />
        </div>
      ) : null}
      {asked('english_level') ? (
        <div>
          <Label htmlFor={id('english_level')}>{t('applicants.english')}</Label>
          <Select id={id('english_level')} name="english_level" required={required('english_level')} defaultValue="">
            <option value="">{t('apply.choose')}</option>
            {ENGLISH_LEVELS.map((key) => (
              <option key={key} value={key}>
                {t(`english.${key}`)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {asked('is_club_member') ? (
        <div className="sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-ink">{t(clubMemberLabel)}</span>
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
      ) : null}
    </div>
  );
}

export function WhyFirstQuestion({ fields, idPrefix }: { fields: ApplyFields; idPrefix: string }) {
  const t = useTranslations('interviews');
  if (fields.why_first === 'off') return null;
  return (
    <div>
      <Label htmlFor={`${idPrefix}-why_first`}>{t('apply.whyFirst')}</Label>
      <Textarea
        id={`${idPrefix}-why_first`}
        name="why_first"
        rows={4}
        required={fields.why_first === 'required'}
        maxLength={2000}
      />
    </div>
  );
}
