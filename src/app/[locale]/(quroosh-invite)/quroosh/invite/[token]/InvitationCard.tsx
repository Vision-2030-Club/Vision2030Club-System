import type { ReactNode } from 'react';
import { QurooshFin, QurooshLogo } from '@/components/QurooshLogo';
import { cx } from '@/components/ui';

/*
 * The guest's invitation, built like the printed speaker card: on the deep
 * navy-purple (the layout, with the fin's large curve behind), everything in
 * one centred column, top to bottom:
 *
 *   InviteHero   the logo, the invitation line (bold lavender), the
 *                greeting, the title small and light with a slash, the
 *                name very large in mint
 *   IntroText    the paragraph, light lavender, airy lines
 *   Highlight    the compact mint box, bold navy (also the booked day)
 *   InfoRow      the days and الرياض between two thin lines
 *   Panel        the card's boxes: thin lavender border, a lighter
 *                translucent fill, a mint fin before a bold mint heading,
 *                small light text
 *
 * The heaviest weight the app's Arabic face has (IBM Plex Sans Arabic) is
 * bold (700); nothing heavier is asked for, so the browser never fakes one.
 * Theme tokens only. No hooks, so the server page and the client form both
 * use these.
 */

/** Panel text on the navy: small and light. */
export const BODY_TEXT = 'text-sm leading-relaxed text-brand-200';

/** The column under the layout's frame; the gaps are the card's. */
export function InviteColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-xl space-y-9 pt-2">{children}</div>;
}

/** The top of the invitation. */
export function InviteHero({
  logoName,
  subtitle,
  greeting,
  title,
  name,
}: {
  /** The logo's accessible name. */
  logoName: string;
  /** "دعوة للمشاركة كمتحدث" or "كمتحدثة". */
  subtitle: string;
  /** "مرحباً بك", shown with a name only. */
  greeting?: string;
  /** The title split off the name ("سعادة الأستاذة"), shown small with a slash. */
  title?: string | null;
  /** The name; the whole saved name when no title was found. */
  name?: string;
}) {
  return (
    <section className="text-center">
      <QurooshLogo name={logoName} className="mx-auto h-20 text-accent-2 sm:h-24" />
      <p className="mt-8 text-2xl font-bold text-brand-300">{subtitle}</p>

      {name ? (
        <div className="mt-5">
          {greeting ? <p className="text-sm text-brand-200">{greeting}</p> : null}
          {title ? <p className="mt-2 text-base text-brand-100">{`${title}/`}</p> : null}
          <h1
            className={cx(
              title ? 'mt-2' : 'mt-3',
              'text-balance text-5xl font-bold leading-[1.1] text-accent-2 sm:text-6xl',
            )}
          >
            {name}
          </h1>
        </div>
      ) : null}
    </section>
  );
}

/** The paragraph under the name: medium, light lavender, centred, airy. */
export function IntroText({ children }: { children: ReactNode }) {
  return <p className="text-center text-base leading-loose text-brand-200 sm:text-lg">{children}</p>;
}

/**
 * The mint box, like the card's quote: bold navy text, as wide as its text
 * and centred. `quote` is the card's compact box: at 15px with small padding
 * the Arabic line ("مسيرتكم في بناء الأعمال…", about 276px in IBM Plex Sans
 * Arabic Bold) stays on one line on a 360px phone. `day` is the larger box
 * of the booked day.
 */
export function Highlight({ children, size = 'quote' }: { children: ReactNode; size?: 'quote' | 'day' }) {
  return (
    <p
      className={cx(
        'mx-auto w-fit max-w-full text-balance rounded-sm bg-accent-2 text-center font-bold text-brand-950',
        size === 'quote'
          ? 'px-4 py-2.5 text-[0.9375rem] leading-normal sm:px-5 sm:text-base'
          : 'px-6 py-4 text-xl leading-relaxed',
      )}
    >
      {children}
    </p>
  );
}

export type InfoItem = { icon: 'calendar' | 'place'; text: string };

/** The info row: thin lines above and below, thin dividers between. */
export function InfoRow({ items }: { items: InfoItem[] }) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-y-2 border-y border-brand-400/40 py-4 text-sm font-bold text-brand-50 [&>li+li]:border-s [&>li+li]:border-brand-400/40">
      {items.map((item) => (
        <li key={item.icon} className="flex flex-1 basis-32 items-center justify-center gap-2 px-4">
          <InfoIcon name={item.icon} />
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The small line icons of the card's info row. */
function InfoIcon({ name }: { name: InfoItem['icon'] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5 shrink-0 text-brand-200"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === 'calendar' ? (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </>
      ) : (
        <>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
          <circle cx="12" cy="10" r="2.3" />
        </>
      )}
    </svg>
  );
}

/** A box like the card's: rounded, thin lavender border, lighter translucent fill. */
export const PANEL = 'rounded-xl border border-brand-400/50 bg-surface/5 px-5 py-4';

/** A panel's heading: bold mint, a small mint fin before it. */
export function PanelHeading({ children, as: Tag = 'h2' }: { children: ReactNode; as?: 'h2' | 'span' }) {
  return (
    <Tag className="flex items-start gap-2 text-base font-bold text-accent-2">
      <QurooshFin className="mt-1 h-4 shrink-0 text-accent" />
      <span>{children}</span>
    </Tag>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={cx(PANEL, 'space-y-3')}>
      {title ? <PanelHeading>{title}</PanelHeading> : null}
      {children}
    </section>
  );
}

/** A booked day, as the guest reads it: after confirming, and on every later visit. */
export function BookedNotice({
  title,
  day,
  thanks,
  change,
}: {
  title: string;
  day?: string;
  thanks: string;
  change?: string;
}) {
  return (
    <div className="space-y-6 text-center">
      <h2 className="text-xl font-bold text-accent-2">{title}</h2>
      {day ? <Highlight size="day">{day}</Highlight> : null}
      <p className="text-base leading-loose text-brand-200">{thanks}</p>
      {change ? <p className="text-sm text-brand-300">{change}</p> : null}
    </div>
  );
}
