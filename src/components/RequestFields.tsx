'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Input, Label, Select, Textarea } from '@/components/ui';
import { fieldApplies, type FieldOptions, type RequestField } from '@/lib/requests';
import { toDateInput, toDateTimeInput } from '@/lib/time';

/**
 * Renders a request type's custom form straight from its `field_schema`.
 *
 * This component is the reason adding a request type needs no new code: the
 * shape of the form is data, and every type — existing or future — is drawn by
 * the same six branches below.
 *
 * A field with `show_when` appears only once the field it depends on holds
 * the right value, and is not in the DOM otherwise — so it is neither
 * submitted nor `required` while hidden. The server applies the same rule
 * (`fieldApplies`), so a required-but-hidden field is never demanded.
 *
 * A field with `no_past` gets a `min` on the club's clock. That is the
 * browser's hint; the action is the check.
 */
export function RequestFields({
  fields,
  options = {},
}: {
  fields: RequestField[];
  /** Live option lists, for selects carrying an `options_source`. */
  options?: FieldOptions;
}) {
  const locale = useLocale();
  const label = (field: RequestField) =>
    locale === 'ar' ? field.label_ar : field.label_en;

  // Only what other fields depend on is tracked: the selects. Text answers
  // never decide whether another question is asked.
  const [values, setValues] = useState<Record<string, string>>({});
  const remember = (key: string, value: string) =>
    setValues((current) => (current[key] === value ? current : { ...current, [key]: value }));

  return (
    <>
      {fields.map((field) => {
        if (!fieldApplies(field, values)) return null;

        const name = `field_${field.key}`;
        const common = { id: name, name, required: field.required };

        return (
          <div key={field.key}>
            <Label htmlFor={name}>{label(field)}</Label>

            {field.type === 'textarea' ? (
              <Textarea {...common} rows={3} />
            ) : field.type === 'select' ? (
              <Select
                {...common}
                value={values[field.key] ?? ''}
                onChange={(event) => remember(field.key, event.target.value)}
              >
                <option value="">—</option>
                {(field.options_source
                  ? (options[field.options_source] ?? [])
                  : (field.options ?? [])
                ).map((option) => (
                  <option key={option.value} value={option.value}>
                    {locale === 'ar' ? option.label_ar : option.label_en}
                  </option>
                ))}
              </Select>
            ) : field.type === 'file' ? (
              <Input
                {...common}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,application/pdf"
              />
            ) : (
              <Input
                {...common}
                type={
                  field.type === 'number'
                    ? 'number'
                    : field.type === 'date'
                      ? 'date'
                      : field.type === 'datetime'
                        ? 'datetime-local'
                        : 'text'
                }
                step={field.type === 'number' ? 'any' : undefined}
                min={
                  field.no_past && field.type === 'date'
                    ? toDateInput(new Date())
                    : field.no_past && field.type === 'datetime'
                      ? toDateTimeInput(new Date())
                      : undefined
                }
              />
            )}
          </div>
        );
      })}
    </>
  );
}
