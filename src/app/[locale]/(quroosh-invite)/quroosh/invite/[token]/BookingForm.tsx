'use client';

import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label, Select } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import type { ActionResult } from '@/lib/actions';
import { DEFAULT_COUNTRY, internationalPhone } from '@/lib/quroosh/phones';
import { bookAction } from './actions';
import { BookedNotice } from './InvitationCard';

/** A free day as the invitation writes it: "الأحد 22 نوفمبر". */
export type SlotOption = { id: string; day: string };
export type CountryOption = { iso: string; dial: string; name: string };

/** The hints after which the list of free days is out of date. */
const STALE = new Set(['slot_taken', 'slot_unavailable']);

/**
 * One choice in the invitation: a full-width row with a lavender border,
 * mint when chosen, as on the printed cards.
 */
const OPTION =
  'flex cursor-pointer items-center gap-3 rounded-xl border border-brand-200 bg-surface px-4 py-3 ' +
  'transition-colors hover:border-brand-400 has-[:checked]:border-accent-3 has-[:checked]:bg-accent-2 ' +
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-3';

/** A section of the invitation: a navy heading over a thin mint rule. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-brand-950">{title}</h2>
        <div className="h-px w-12 bg-accent" aria-hidden="true" />
      </div>
      {children}
    </section>
  );
}

/**
 * The guest's choice of day and contact details, inside their invitation
 * card (Quroosh 0005): one of the free days, their mobile number with a
 * country picker, whether they need transport (then the number of their
 * driver or office manager). After confirming, a formal acknowledgement.
 *
 * As on the application form, whatever goes wrong the guest keeps what they
 * typed: the submit is sent from onSubmit rather than by the form's own
 * action (React resets a form after its action runs, refusals included), and
 * a request that fails outright becomes a translated message. When the day
 * they chose was just taken, the page's free days are reloaded, so it drops
 * out of the list.
 *
 * The phone numbers are checked here first only so the message can name the
 * field; the action decides.
 */
export function BookingForm({
  token,
  locale,
  slots,
  countries,
}: {
  token: string;
  locale: string;
  slots: SlotOption[];
  countries: CountryOption[];
}) {
  const t = useTranslations('quroosh.invite');
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
      <div className="border-t border-brand-200 pt-8">
        <BookedNotice
          title={t('booked.title')}
          day={state.data?.day}
          thanks={t('booked.next')}
        />
      </div>
    );
  }

  const hint = problem ?? state.hint;
  const errorText =
    problem || state.error ? (hint && t.has(`errors.${hint}`) ? t(`errors.${hint}`) : (state.error ?? null)) : null;

  const phoneField = (name: string, label: string, help: string) => (
    <div>
      <Label htmlFor={`${name}-number`}>{label}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select
          id={`${name}-country`}
          name={`${name}_country`}
          defaultValue={DEFAULT_COUNTRY}
          aria-label={t('country')}
          className="sm:w-60"
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
    <form action={formAction} onSubmit={onSubmit} className="space-y-8 border-t border-brand-200 pt-8">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <div className="hidden" aria-hidden="true">
        <label>
          Website <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <Section title={t('chooseSlot')}>
        <div className="space-y-2">
          {slots.map((slot) => (
            <label key={slot.id} className={OPTION}>
              <input type="radio" name="slot_id" value={slot.id} required className="size-4 shrink-0 accent-accent-3" />
              <span className="min-w-0 flex-1 font-semibold text-brand-950">{slot.day}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title={t('contactTitle')}>
        <div className="space-y-6">
          {phoneField('phone', t('phone'), t('phoneHint'))}

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-brand-950">{t('transport')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {(['yes', 'no'] as const).map((value) => (
                <label key={value} className={OPTION}>
                  <input
                    type="radio"
                    name="needs_transport"
                    value={value}
                    required
                    className="size-4 shrink-0 accent-accent-3"
                    onChange={() => setTransport(value === 'yes')}
                  />
                  <span className="text-sm text-brand-950">{t(value)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {transport ? phoneField('transport_phone', t('transportPhone'), t('transportPhoneHint')) : null}
        </div>
      </Section>

      {errorText ? <Alert tone="danger">{errorText}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full py-3 text-base">
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
