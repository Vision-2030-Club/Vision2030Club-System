'use client';

import type { ComponentProps, FormEvent, SyntheticEvent } from 'react';
import { Input, Select } from '@/components/ui';

/*
 * Required fields that say what is missing in the page's language. Left to
 * itself the browser answers an empty required field in its own language
 * ("Please select an item in the list." on an Arabic page); these set our
 * translated `message` instead when the field is empty, and clear it as soon
 * as the field changes, so the browser checks it afresh.
 *
 * Only the empty case is replaced: a field's other limits (maxLength) stop
 * the typing before a message is needed. The message comes translated from
 * the page, so a server page can use these too.
 */

function whenEmpty(message: string) {
  return (event: SyntheticEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.currentTarget.validity.valueMissing) event.currentTarget.setCustomValidity(message);
  };
}

function clear(event: FormEvent<HTMLInputElement | HTMLSelectElement>) {
  event.currentTarget.setCustomValidity('');
}

export function RequiredInput({ message, onInput, ...props }: ComponentProps<'input'> & { message: string }) {
  return (
    <Input
      {...props}
      required
      onInvalid={whenEmpty(message)}
      onInput={(event) => {
        clear(event);
        onInput?.(event);
      }}
    />
  );
}

export function RequiredSelect({ message, onChange, ...props }: ComponentProps<'select'> & { message: string }) {
  return (
    <Select
      {...props}
      required
      onInvalid={whenEmpty(message)}
      onChange={(event) => {
        clear(event);
        onChange?.(event);
      }}
    />
  );
}
