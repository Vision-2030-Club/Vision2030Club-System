'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cx } from '@/components/ui';

export type PickerCompany = {
  id: string;
  name: string;
  description?: string;
  logo_url: string | null;
  is_full: boolean;
};

/**
 * Companies as cards, chosen by tapping, up to `max`. The order they are
 * tapped in is the order of preference: each chosen card carries its number,
 * and the hidden `preference` inputs are written in that order, which is what
 * submit_application reads as rank.
 *
 * A FULL company stays on the grid, blurred and inert, so a student sees it
 * exists and why they cannot pick it; the database refuses it regardless.
 * Once `max` are chosen the rest dim (without the blur) until one is undone.
 */
export function CompanyPicker({ companies, max }: { companies: PickerCompany[]; max: number }) {
  const t = useTranslations('interviews');
  const [chosen, setChosen] = useState<string[]>([]);

  const toggle = (id: string) =>
    setChosen((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : prev.length < max ? [...prev, id] : prev));

  return (
    <div className="space-y-2">
      {chosen.map((id) => (
        <input key={id} type="hidden" name="preference" value={id} />
      ))}
      <p className="text-xs text-ink-muted" aria-live="polite">
        {t('register.chosen', { count: chosen.length, max })}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {companies.map((company) => {
          const rank = chosen.indexOf(company.id) + 1;
          const selected = rank > 0;
          const atLimit = !selected && chosen.length >= max;
          const disabled = company.is_full || atLimit;
          return (
            <li key={company.id} className="relative">
              <button
                type="button"
                onClick={() => toggle(company.id)}
                disabled={disabled}
                aria-pressed={selected}
                className={cx(
                  'flex w-full items-center gap-3 rounded-lg border p-3 text-start',
                  'transition-[background-color,border-color,box-shadow,opacity] duration-150',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
                  'touch-manipulation',
                  selected
                    ? 'border-brand-600 bg-brand-50 shadow-sm ring-1 ring-brand-600'
                    : 'border-line bg-surface hover:bg-surface-muted',
                  company.is_full && 'pointer-events-none cursor-not-allowed opacity-50 blur-[1px]',
                  atLimit && 'cursor-not-allowed opacity-60',
                )}
              >
                <Logo company={company} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{company.name}</span>
                  {company.description ? (
                    <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted">{company.description}</span>
                  ) : null}
                </span>
                {/* A full card has the Full label here instead (outside the blur, below). */}
                <span
                  aria-hidden="true"
                  className={cx(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                    selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-line',
                    company.is_full && 'invisible',
                  )}
                >
                  {selected ? <span className="ltr-nums">{rank}</span> : null}
                </span>
                {selected ? <span className="sr-only">{t('register.choiceN', { n: rank })}</span> : null}
              </button>
              {/* Outside the blurred button, so the reason stays readable. */}
              {company.is_full ? (
                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 rounded-full bg-warn px-2 py-0.5 text-xs font-semibold text-white">
                  {t('register.full')}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Logo({ company, size = 'md' }: { company: { name: string; logo_url: string | null }; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-12' : 'size-10';
  if (company.logo_url) {
    return (
      // Logos are either uploaded (a small data: image, see LogoInput) or an
      // external URL pasted in; next/image would need every host allow-listed.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={company.logo_url}
        alt=""
        width={48}
        height={48}
        className={cx(box, 'shrink-0 rounded-lg border border-line bg-surface-muted object-contain p-1')}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cx(
        box,
        'flex shrink-0 items-center justify-center rounded-lg border border-line bg-surface-muted text-sm font-semibold text-ink-muted',
      )}
    >
      {company.name.trim().slice(0, 2).toUpperCase()}
    </span>
  );
}
