'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Card, Input, Label, Select } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import type { ActionResult } from '@/lib/actions';
import { DEFAULT_COUNTRY, internationalPhone } from '@/lib/quroosh/phones';
import { bookAction } from './actions';

export type SlotDayOption = { day: string; slots: { id: string; time: string }[] };
export type CountryOption = { iso: string; dial: string; name: string };

/** The hints after which the list of free times is out of date. */
const STALE = new Set(['slot_taken', 'slot_unavailable']);

/**
 * The guest's booking form (Quroosh 0005): one of the free times, their
 * mobile number with a country picker, and whether they need transport (then
 * the number of their driver or office manager).
 *
 * As on the application form, whatever goes wrong the guest keeps what they
 * typed: the submit is sent from onSubmit rather than by the form's own
 * action (React resets a form after its action runs, refusals included), and
 * a request that fails outright becomes a translated message. When the time
 * they chose was just taken, the page's free times are reloaded, so it drops
 * out of the list.
 *
 * The phone numbers are checked here first only so the message can name the
 * field; the action decides.
 */
export function BookingForm({
  token,
  locale,
  days,
  countries,
}: {
  token: string;
  locale: string;
  days: SlotDayOption[];
  countries: CountryOption[];
}) {
  const t = useTranslations('quroosh.invite');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (previous, formData) => {
      try {
        const result = await bookAction(previous, formData);
        if (result.hint && STALE.has(result.hint)) router.refresh();
        return result;
      } catch {
        return { ok: false, error: 'network', hint: 'network' };
      }
    },
    { ok: false },
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [transport, setTransport] = useState<boolean | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    const read = (key: string) => String(formData.get(key) ?? '');
    let found: string | null = null;
    if (!formData.get('slot_id')) found = 'slot_missing';
    else if (!internationalPhone(read('phone_country'), read('phone'))) found = 'phone_invalid';
    else if (transport && read('transport_phone').trim() === '') found = 'transport_phone_missing';
    else if (transport && !internationalPhone(read('transport_phone_country'), read('transport_phone'))) {
      found = 'transport_phone_invalid';
    }
    setProblem(found);
    if (found) return;
    startTransition(() => formAction(formData));
  };

  if (state.ok) {
    return (
      <Card className="space-y-2">
        <h2 className="text-lg font-semibold text-ink">{t('booked.title')}</h2>
        {state.data?.day ? <p className="text-ink">{state.data.day}</p> : null}
        {state.data?.time ? (
          <p className="ltr-nums text-lg font-semibold text-ink" dir="ltr">
            {state.data.time}
          </p>
        ) : null}
        <p className="text-sm text-ink-muted">{t('booked.next')}</p>
      </Card>
    );
  }

  const hint = problem ?? state.hint;
  const errorText =
    problem || state.error ? (hint && t.has(`errors.${hint}`) ? t(`errors.${hint}`) : (state.error ?? null)) : null;

  const phoneField = (name: string, label: string, help: string) => (
    <div>
      <Label htmlFor={`${name}-number`}>{label}</Label>
      <div className="flex flex-wrap gap-2 sm:flex-nowrap">
        <Select
          id={`${name}-country`}
          name={`${name}_country`}
          defaultValue={DEFAULT_COUNTRY}
          aria-label={t('country')}
          className="sm:w-56"
        >
          {countries.map(({ iso, dial, name: country }) => (
            <option key={iso} value={iso}>
              {/* The code kept left-to-right inside Arabic text. */}
              {`${country} ⁦+${dial}⁩`}
            </option>
          ))}
        </Select>
        <Input
          id={`${name}-number`}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete={name === 'phone' ? 'tel' : 'off'}
          dir="ltr"
          required
          maxLength={20}
          className="min-w-0 flex-1"
        />
      </div>
      <p className="mt-1 text-xs text-ink-muted">{help}</p>
    </div>
  );

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <div className="hidden" aria-hidden="true">
        <label>
          Website <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <fieldset className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-sm">
        <legend className="px-1 text-base font-semibold text-brand-700">{t('chooseSlot')}</legend>
        {days.map(({ day, slots }) => (
          <div key={day} className="space-y-2">
            <p className="text-sm font-semibold text-ink-muted">{day}</p>
            <div className="flex flex-wrap gap-2">
              {slots.map((slot) => (
                <label
                  key={slot.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
                >
                  <input type="radio" name="slot_id" value={slot.id} required className="accent-brand-600" />
                  <span className="ltr-nums" dir="ltr">
                    {slot.time}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <fieldset className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-sm">
        <legend className="px-1 text-base font-semibold text-brand-700">{t('contactTitle')}</legend>
        {phoneField('phone', t('phone'), t('phoneHint'))}

        <fieldset>
          <legend className="text-sm font-medium text-ink">{t('transport')}</legend>
          <div className="mt-2 space-y-2">
            {(['yes', 'no'] as const).map((value) => (
              <label key={value} className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="needs_transport"
                  value={value}
                  required
                  className="mt-1 accent-brand-600"
                  onChange={() => setTransport(value === 'yes')}
                />
                <span>{t(value)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {transport ? phoneField('transport_phone', t('transportPhone'), t('transportPhoneHint')) : null}
      </fieldset>

      {errorText ? <Alert tone="danger">{errorText}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? tCommon('loading') : t('submit')}
      </Button>
    </form>
  );
}
