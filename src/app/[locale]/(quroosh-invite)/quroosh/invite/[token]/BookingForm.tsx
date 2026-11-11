'use client';

import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { ActionResult } from '@/lib/actions';
import { DEFAULT_COUNTRY, internationalPhone } from '@/lib/quroosh/phones';
import { bookAction } from './actions';
import { BookedNotice, InfoRow, PANEL, Panel, PanelHeading, type InfoItem } from './InvitationCard';

/** A free day as the invitation writes it: "الأحد 22 نوفمبر". */
export type SlotOption = { id: string; day: string };
export type CountryOption = { iso: string; dial: string; name: string };

/** The hints after which the list of free days is out of date. */
const STALE = new Set(['slot_taken', 'slot_unavailable']);

/*
 * The form sits on the navy, so it does not use the app's Input, Select,
 * Label and Button, which are drawn for light pages: these classes draw the
 * same controls for the dark, on this page only. Light text on a translucent
 * background with a lavender border, mint when focused or chosen. Native
 * lists of options get the navy too (`option` ignores translucency).
 */
const FIELD =
  'w-full rounded-lg border border-brand-400/50 bg-surface/5 px-3 py-2.5 text-base text-brand-50 ' +
  'outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30 touch-manipulation ' +
  '[&>option]:bg-brand-950 [&>option]:text-surface';

const LABEL = 'mb-1.5 block text-sm font-semibold text-brand-100';
const HINT = 'mt-1.5 text-xs text-brand-300';

/** One choice: a full-width row, mint with navy text when chosen. */
const OPTION =
  'flex cursor-pointer items-center gap-3 rounded-lg border border-brand-400/50 bg-surface/5 px-4 py-3 text-brand-50 ' +
  'transition-colors hover:border-accent has-[:checked]:border-accent-2 has-[:checked]:bg-accent-2 ' +
  'has-[:checked]:text-brand-950 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ' +
  'has-[:focus-visible]:outline-accent';

/*
 * The radio drawn by hand: the browser's own is a solid dark disc on the
 * navy in iPhone Safari, which reads as chosen. Unchosen, an empty lavender
 * ring; chosen (on the option's mint), a navy ring around a navy dot.
 */
const RADIO =
  'size-5 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-brand-300 bg-transparent ' +
  'transition-colors checked:border-brand-950 checked:bg-brand-950 ' +
  'checked:shadow-[inset_0_0_0_3px_var(--color-accent-2)]';

/**
 * The guest's choice of day and contact details on their invitation
 * (Quroosh 0005): one of the free days, their mobile number with a country
 * picker, whether they need transport (then a contact number for
 * coordination), each in its own panel.
 *
 * The page hands it `lead`, what shows before booking only (the intro, the
 * mint box, the info row with the days on offer), and
 * it renders that above the form. The moment the guest has booked, both go
 * and the info row comes back with their day, above the confirmation: the
 * page then reads exactly as on a later visit, and is reloaded from the
 * server to stay so.
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
  lead,
  place,
}: {
  token: string;
  locale: string;
  slots: SlotOption[];
  countries: CountryOption[];
  /** What the page shows before booking only (intro, mint box, info row). */
  lead: ReactNode;
  /** The info row's place, for the row with the booked day. */
  place: InfoItem;
}) {
  const t = useTranslations('quroosh.invite');
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (previous, formData) => {
      try {
        const result = await bookAction(previous, formData);
        if (result.ok || (result.hint && STALE.has(result.hint))) router.refresh();
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
    const day = state.data?.day;
    return (
      <>
        <InfoRow items={day ? [{ icon: 'calendar', text: day }, place] : [place]} />
        <BookedNotice title={t('booked.title')} day={day} thanks={t('booked.next')} change={t('booked.change')} />
      </>
    );
  }

  const hint = problem ?? state.hint;
  const errorText =
    problem || state.error ? (hint && t.has(`errors.${hint}`) ? t(`errors.${hint}`) : (state.error ?? null)) : null;

  const phoneField = (name: string, label: string, help?: string) => (
    <div>
      <label htmlFor={`${name}-number`} className={LABEL}>
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          id={`${name}-country`}
          name={`${name}_country`}
          defaultValue={DEFAULT_COUNTRY}
          aria-label={t('country')}
          className={`${FIELD} sm:w-60`}
        >
          {countries.map(({ iso, dial, name: country }) => (
            <option key={iso} value={iso}>
              {/* The code kept left-to-right inside Arabic text. */}
              {`${country} ⁦+${dial}⁩`}
            </option>
          ))}
        </select>
        <input
          id={`${name}-number`}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete={name === 'phone' ? 'tel' : 'off'}
          dir="ltr"
          required
          maxLength={20}
          className={`${FIELD} min-w-0 flex-1`}
        />
      </div>
      {help ? <p className={HINT}>{help}</p> : null}
    </div>
  );

  return (
    <>
      {lead}
      <form action={formAction} onSubmit={onSubmit} className="space-y-4 [color-scheme:dark]">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="locale" value={locale} />
        <div className="hidden" aria-hidden="true">
          <label>
            Website <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <Panel title={t('chooseSlot')}>
          <div className="space-y-2">
            {slots.map((slot) => (
              <label key={slot.id} className={OPTION}>
                <input type="radio" name="slot_id" value={slot.id} required className={RADIO} />
                <span className="min-w-0 flex-1 font-semibold">{slot.day}</span>
              </label>
            ))}
          </div>
        </Panel>

        <Panel title={t('contactTitle')}>{phoneField('phone', t('phone'), t('phoneHint'))}</Panel>

        {/* The panel is on a wrapper: a fieldset's own border would cut through its legend. */}
        <div className={PANEL}>
          <fieldset className="space-y-4">
            <legend>
              <PanelHeading as="span">{t('transport')}</PanelHeading>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(['yes', 'no'] as const).map((value) => (
                <label key={value} className={OPTION}>
                  <input
                    type="radio"
                    name="needs_transport"
                    value={value}
                    required
                    className={RADIO}
                    onChange={() => setTransport(value === 'yes')}
                  />
                  <span className="text-sm font-semibold">{t(value)}</span>
                </label>
              ))}
            </div>
            {transport ? phoneField('transport_phone', t('transportPhone')) : null}
          </fieldset>
        </div>

        {errorText ? (
          <p role="alert" className="rounded-lg border border-danger bg-danger/25 px-4 py-3 text-sm text-surface">
            {errorText}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full touch-manipulation rounded-sm bg-accent-2 px-4 py-4 text-lg font-bold text-brand-950 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {pending ? t('submitting') : t('submit')}
        </button>
      </form>
    </>
  );
}
