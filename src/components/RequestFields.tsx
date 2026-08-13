'use client';

import { useLocale } from 'next-intl';
import { Input, Label, Select, Textarea } from '@/components/ui';
import type { RequestField } from '@/lib/requests';

/**
 * Renders a request type's custom form straight from its `field_schema`.
 *
 * This component is the reason adding a request type needs no new code: the
 * shape of the form is data, and every type — existing or future — is drawn by
 * the same six branches below.
 */
export function RequestFields({ fields }: { fields: RequestField[] }) {
  const locale = useLocale();
  const label = (field: RequestField) =>
    locale === 'ar' ? field.label_ar : field.label_en;

  return (
    <>
      {fields.map((field) => {
        const name = `field_${field.key}`;
        const common = { id: name, name, required: field.required };

        return (
          <div key={field.key}>
            <Label htmlFor={name}>{label(field)}</Label>

            {field.type === 'textarea' ? (
              <Textarea {...common} rows={3} />
            ) : field.type === 'select' ? (
              <Select {...common}>
                <option value="">—</option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {locale === 'ar' ? option.label_ar : option.label_en}
                  </option>
                ))}
              </Select>
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
              />
            )}
          </div>
        );
      })}
    </>
  );
}
