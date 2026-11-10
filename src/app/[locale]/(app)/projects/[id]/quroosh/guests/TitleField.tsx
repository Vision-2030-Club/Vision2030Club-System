'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input, Label, Select } from '@/components/ui';
import { GUEST_TITLES, MAX_CUSTOM_TITLE } from '@/lib/quroosh/guestTitles';

/**
 * The guest's title on the New invitation form, before the name: a dropdown
 * of the usual titles, "Other" (a small field for the manager's own, optional:
 * left empty, the name is saved with no title) and "No title". The action
 * puts the title in front of the name and saves it as the name
 * (guestTitles.ts). A choice in the dropdown is required, so nobody is
 * invited without the managers deciding how they are addressed.
 */
export function TitleField() {
  const t = useTranslations('quroosh.guests.new');
  const [title, setTitle] = useState('');

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor="guest-title">{t('titleLabel')}</Label>
        <Select
          id="guest-title"
          name="title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        >
          <option value="" disabled>
            {t('titleChoose')}
          </option>
          {GUEST_TITLES.map((key) => (
            <option key={key} value={key}>
              {t(`titles.${key}.option`)}
            </option>
          ))}
        </Select>
      </div>
      {title === 'other' ? (
        <div>
          <Label htmlFor="guest-title-custom">{t('titleCustom')}</Label>
          <Input
            id="guest-title-custom"
            name="title_custom"
            maxLength={MAX_CUSTOM_TITLE}
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-ink-muted">{t('titleCustomHint')}</p>
        </div>
      ) : null}
    </div>
  );
}
