'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label, Select } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import type { ActionResult } from '@/lib/actions';
import { DEFAULT_COUNTRY, internationalPhone } from '@/lib/quroosh/phones';
import { joinAction } from './actions';

export type CountryOption = { iso: string; dial: string; name: string };

/**
 * The sign-up form of an event (0075): name, mobile with a country picker,
 * and email. On success the person's pass opens.
 *
 * As on the Quroosh forms, whatever goes wrong the person keeps what they
 * typed: the submit is sent from onSubmit rather than by the form's own
 * action (React resets a form after its action runs, refusals included), and
 * a request that fails outright becomes a translated message. The mobile is
 * checked here first only so the message can name the field; the server
 * decides.
 */
export function JoinForm({
  projectId,
  locale,
  countries,
}: {
  projectId: string;
  locale: string;
  countries: CountryOption[];
}) {
  const t = useTranslations('eventAttendance');
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (previous, formData) => {
      try {
        const result = await joinAction(previous, formData);
        if (result.ok && result.data?.token) router.push(`/event/pass/${result.data.token}?new=1`);
        return result;
      } catch {
        return { ok: false, error: t('errors.network'), hint: 'network' };
      }
    },
    { ok: false },
  );
  const [problem, setProblem] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    const valid = internationalPhone(String(formData.get('phone_country') ?? ''), String(formData.get('phone') ?? ''));
    setProblem(valid ? null : t('errors.phone_invalid'));
    if (!valid) return;
    startTransition(() => formAction(formData));
  };

  // Already registered: nothing more to fill in.
  if (state.ok && !state.data?.token) return <Alert tone="info">{t('join.already')}</Alert>;

  const error = problem ?? state.error ?? null;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="locale" value={locale} />
      {/* Hidden from people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -start-[9999px] size-px overflow-hidden">
        <label htmlFor="join-website">Website</label>
        <input id="join-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <Label htmlFor="join-name">{t('join.name')}</Label>
        <Input id="join-name" name="name" required minLength={2} maxLength={200} autoComplete="name" />
        <p className="mt-1 text-xs text-ink-muted">{t('join.nameHint')}</p>
      </div>

      <div>
        <Label htmlFor="join-phone">{t('join.mobile')}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            name="phone_country"
            defaultValue={DEFAULT_COUNTRY}
            aria-label={t('join.country')}
            className="sm:w-56"
          >
            {countries.map(({ iso, dial, name }) => (
              <option key={iso} value={iso}>
                {/* The code kept left-to-right inside Arabic text. */}
                {`${name} ⁦+${dial}⁩`}
              </option>
            ))}
          </Select>
          <Input
            id="join-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            required
            maxLength={20}
            placeholder="05XXXXXXXX"
            className="min-w-0 flex-1"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="join-email">{t('join.email')}</Label>
        <Input
          id="join-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          required
          maxLength={254}
        />
        <p className="mt-1 text-xs text-ink-muted">{t('join.emailHint')}</p>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full py-3 text-base">
        {pending ? t('join.sending') : t('join.submit')}
      </Button>
    </form>
  );
}
