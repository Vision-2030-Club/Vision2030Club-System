import type { ReactNode } from 'react';
import { QurooshFin, QurooshLogo } from '@/components/QurooshLogo';
import { cx } from '@/components/ui';

/*
 * The guest's invitation, following the printed invitation cards: dark all
 * the way down (the layout's navy), the logo with its tagline, the invitation
 * line in bold lavender, the greeting, the guest's title small and white with
 * a slash and their name large in mint, and an info row between two thin
 * lines. Below it, everything sits straight on the navy: panels like the
 * cards' info boxes (a thin lavender border, a slightly lighter translucent
 * background, a mint fin before the heading), and a mint box like the cards'
 * quote for the one line that matters most (the welcome before booking, the
 * booked day after). Theme tokens only; phone first.
 *
 * No hooks, so the server page and the client form both use these.
 */

/** Body text on the navy: light lavender. */
export const BODY_TEXT = 'leading-relaxed text-brand-200';

/** The top of the invitation. */
export function InviteHero({
  logoName,
  subtitle,
  greeting,
  title,
  name,
  info,
}: {
  /** The logo's accessible name. */
  logoName: string;
  /** The lavender line: "دعوة للمشاركة كمتحدث". */
  subtitle: string;
  /** "مرحباً بك", shown with a name only. */
  greeting?: string;
  /** The title split off the name ("سعادة الأستاذة"), shown small with a slash. */
  title?: string | null;
  /** The name, large in mint; the whole saved name when no title was found. */
  name?: string;
  /** The info row's items, in order; empty ones are left out. */
  info?: { icon: 'calendar' | 'place'; text: string }[];
}) {
  return (
    <section className="mx-auto max-w-xl pb-8 pt-2 text-center">
      <QurooshLogo name={logoName} className="mx-auto h-20 text-accent-2 sm:h-24" />
      <p className="mt-6 text-lg font-bold text-brand-200">{subtitle}</p>

      {name ? (
        <div className="mt-6">
          {greeting ? <p className="text-sm text-brand-200">{greeting}</p> : null}
          {title ? <p className="mt-3 text-sm text-surface">{`${title}/`}</p> : null}
          <h1 className={`${title ? 'mt-1' : 'mt-3'} text-balance text-4xl font-bold leading-tight text-accent sm:text-5xl`}>
            {name}
          </h1>
        </div>
      ) : null}

      {info && info.length > 0 ? (
        <ul className="mt-8 flex flex-wrap items-center justify-center gap-y-2 border-y border-brand-400/40 py-3 text-sm font-semibold text-surface [&>li+li]:border-s [&>li+li]:border-brand-400/40">
          {info.map((item) => (
            <li key={item.icon} className="flex items-center gap-2 px-4">
              <InfoIcon name={item.icon} />
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The small line icons of the card's info row, in mint. */
function InfoIcon({ name }: { name: 'calendar' | 'place' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4 shrink-0 text-accent"
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

/** Everything under the hero, straight on the navy. */
export function InviteBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-xl space-y-5">{children}</div>;
}

/** A panel like the cards' info boxes: thin lavender border, lighter translucent background. */
export const PANEL = 'rounded-2xl border border-brand-400/40 bg-surface/5 p-5';

/** A panel's heading: a small mint fin before it, like "الجلسة الحوارية" on the cards. */
export function PanelHeading({ children, as: Tag = 'h2' }: { children: ReactNode; as?: 'h2' | 'span' }) {
  return (
    <Tag className="flex items-start gap-2 text-base font-bold text-accent-2">
      <QurooshFin className="mt-0.5 h-4 shrink-0 text-accent" />
      <span>{children}</span>
    </Tag>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={cx(PANEL, 'space-y-4')}>
      {title ? <PanelHeading>{title}</PanelHeading> : null}
      {children}
    </section>
  );
}

/** The mint box, like the cards' quote: navy bold text. */
export function Highlight({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx('rounded-md bg-accent-2 px-5 py-4 text-center font-bold leading-relaxed text-brand-950', className)}>
      {children}
    </p>
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
    <div className="space-y-5 text-center">
      <h2 className="text-lg font-bold text-accent-2">{title}</h2>
      {day ? <Highlight className="text-xl">{day}</Highlight> : null}
      <p className={BODY_TEXT}>{thanks}</p>
      {change ? <p className="text-sm text-brand-300">{change}</p> : null}
    </div>
  );
}
