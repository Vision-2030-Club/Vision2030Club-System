import Image from 'next/image';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { cx } from '@/components/ui';

// The pictures by path with their sizes, as the rest of the app does: an
// imported .png needs next-env.d.ts, which CI's typecheck does not have.
const LOGO = { src: '/brand/quroosh-logo-rayh.png', width: 720, height: 308 };
const COINS_TEAL = { src: '/brand/quroosh-coins-teal.png', width: 420, height: 311 };
const COINS_PURPLE = { src: '/brand/quroosh-coins-purple.png', width: 420, height: 311 };

/*
 * The Quroosh guest pages' design (the identity file and the Figma "Session
 * check-in"): a navy hero with the logo ("Powered by RAYH") and a pair of
 * the identity's coins, the page's title and a line under it, the language
 * as a pill, and a soft wave into a light lavender page; the body holds a
 * white card; a navy wave closes the page. The coins are teal in English and
 * purple in Arabic, as the design shows them. Pictures are cut from the
 * identity PDF (public/brand/quroosh-*.png). Colours are theme tokens, so it
 * only looks right under `data-theme="quroosh"`.
 */

/** A whole Quroosh guest page: the hero, the body column, the closing wave. */
export async function QurooshPage({
  name,
  title,
  subtitle,
  children,
  width = 'max-w-md',
}: {
  /** The logo's accessible name. */
  name: string;
  /** The page's heading in the hero; left out, the hero carries only the logo and the coins. */
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  return (
    <>
      <QurooshHero name={name} title={title} subtitle={subtitle} width={width} />
      <main className={cx('mx-auto w-full flex-1 space-y-5 px-5 pt-6 pb-12', width)}>{children}</main>
      <QurooshFooterWave />
    </>
  );
}

export async function QurooshHero({
  name,
  title,
  subtitle,
  width = 'max-w-md',
}: {
  name: string;
  /** The page's heading in the hero; left out, the hero carries only the logo and the coins. */
  title?: ReactNode;
  subtitle?: ReactNode;
  width?: string;
}) {
  const ar = (await getLocale()) === 'ar';
  return (
    <div className="relative">
      <header className="relative overflow-hidden bg-brand-950 text-brand-50">
        {/* A soft light behind the logo, as in the design. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 start-0 size-72 rounded-full bg-brand-600/25 blur-3xl"
        />
        <div className={cx('relative mx-auto w-full px-6 pt-9 pb-14', width)}>
          <div className="flex items-start justify-between gap-2">
            <Image {...LOGO} alt={name} priority className="h-auto w-44 shrink-0" sizes="176px" />
            <Image
              {...(ar ? COINS_PURPLE : COINS_TEAL)}
              alt=""
              aria-hidden="true"
              priority
              sizes="150px"
              className="-me-10 -mt-3 h-auto w-36 shrink-0 rotate-[20deg] select-none"
            />
          </div>
          {title ? <h1 className="mt-8 text-balance text-4xl font-bold leading-tight">{title}</h1> : null}
          {subtitle ? <p className="mt-2 text-base text-brand-200">{subtitle}</p> : null}
          <div className={cx('flex justify-end', title ? 'mt-8' : 'mt-2')}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-800 bg-brand-950 ps-3 text-brand-50">
              <GlobeIcon />
              <LocaleSwitch className="rounded-full py-2 pe-4 text-sm font-medium text-brand-50" />
            </span>
          </div>
        </div>
      </header>
      {/* The wave: the lavender page rising into the navy. Outside the
          header's clipping and a pixel past its edge, so no seam shows where
          the header's height falls between two pixels. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 400 40"
        preserveAspectRatio="none"
        className="absolute inset-x-0 -bottom-px block h-8 w-full fill-canvas"
      >
        <path d="M0 40V22C70 2 140 0 200 12s130 22 200 4v24z" />
      </svg>
    </div>
  );
}

/** The navy wave closing the page at the bottom, the hero's echo. */
export function QurooshFooterWave() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 40"
      preserveAspectRatio="none"
      className="mt-auto block h-10 w-full fill-brand-950"
    >
      <path d="M0 18C80 34 150 36 220 24S340 4 400 12v28H0z" />
    </svg>
  );
}

/** The design's white card, with an optional icon tile and heading. */
export function QurooshCard({
  icon,
  title,
  children,
  className,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'space-y-5 rounded-3xl border border-brand-950/60 bg-surface p-6 shadow-xl shadow-brand-950/10',
        className,
      )}
    >
      {icon ? (
        <span className="grid size-11 place-items-center rounded-xl border border-brand-300 bg-brand-100 text-brand-600">
          {icon}
        </span>
      ) : null}
      {title ? <h2 className="text-xl font-bold text-ink">{title}</h2> : null}
      {children}
    </section>
  );
}

/** The design's quiet note under a card: an info mark and a line of help. */
export function QurooshNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2.5 rounded-2xl bg-surface-muted p-4 text-sm leading-relaxed text-ink-muted">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="mt-0.5 size-5 shrink-0 text-accent-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

function GlobeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  );
}
