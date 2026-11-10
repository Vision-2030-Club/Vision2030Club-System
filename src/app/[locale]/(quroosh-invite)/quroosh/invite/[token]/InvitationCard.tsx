import type { ReactNode } from 'react';
import { QurooshLogo } from '@/components/QurooshLogo';

/*
 * The guest's invitation, following the printed invitation cards: on the
 * navy page (the layout), the logo with its tagline, a lavender line saying
 * what the invitation is, the greeting, the guest's title small with a slash
 * and their name large in mint, and an info row with small icons. Below it,
 * a white card holds the form or the message, and the confirmation sits in a
 * mint box. Theme tokens only; phone first.
 *
 * No hooks, so the server page and the client form both use these.
 */

/** The top of the invitation, dark like the card. */
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
      <p className="mt-6 text-base font-semibold text-brand-200">{subtitle}</p>

      {name ? (
        <div className="mt-8">
          {greeting ? <p className="text-sm text-brand-200">{greeting}</p> : null}
          {title ? <p className="mt-3 text-sm font-semibold text-surface">{`${title}/`}</p> : null}
          <h1 className={`${title ? 'mt-1' : 'mt-3'} text-balance text-3xl font-bold leading-tight text-accent sm:text-4xl`}>
            {name}
          </h1>
        </div>
      ) : null}

      {info && info.length > 0 ? (
        <ul className="mt-8 flex flex-wrap items-center justify-center gap-y-2 text-sm text-surface [&>li+li]:border-s [&>li+li]:border-brand-400">
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

/** The white card under the hero: rounded, with a lavender border. */
export function InviteCard({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl space-y-8 rounded-2xl border border-brand-200 bg-surface p-6 shadow-sm sm:p-8">
      {children}
    </div>
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
      <h2 className="text-lg font-semibold text-brand-950">{title}</h2>
      {day ? (
        <p className="rounded-xl border border-accent bg-accent-2 px-4 py-4 text-xl font-semibold text-brand-950">
          {day}
        </p>
      ) : null}
      <p className="leading-relaxed text-ink">{thanks}</p>
      {change ? <p className="text-sm text-ink-muted">{change}</p> : null}
    </div>
  );
}
