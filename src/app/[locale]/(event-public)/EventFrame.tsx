import type { ReactNode } from 'react';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { QurooshLogo } from '@/components/QurooshLogo';
import type { EventTheme } from '@/lib/eventAttendance/types';

/**
 * The header and the colours of one event's public pages.
 *
 * An event wears the identity of the project it belongs to: a project that
 * also carries Quroosh gets the Quroosh palette and mark, one that carries
 * Mock Interviews gets that palette, any other the club's. The palettes hang
 * off `data-theme` on <html> (globals.css). The root layout sets that from
 * the address before the first paint, but `/event/...` says nothing about
 * the project, so the small script here sets it, placed first so it runs
 * before the page below it is painted.
 */
export function EventFrame({
  theme,
  name,
  children,
}: {
  theme: EventTheme;
  /** The project's name in the page's language. */
  name: string;
  children: ReactNode;
}) {
  return (
    <>
      {theme ? (
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)})`,
          }}
        />
      ) : null}
      <header className={theme === 'quroosh' ? 'bg-brand-950' : 'border-b border-line bg-surface'}>
        <div className="mx-auto flex max-w-xl items-center gap-4 px-4 py-4">
          {theme === 'quroosh' ? (
            <QurooshLogo name={name} className="h-12 text-accent-2" />
          ) : (
            <span className="min-w-0 truncate text-lg font-semibold text-ink">{name}</span>
          )}
          <div className="ms-auto rounded-lg bg-surface">
            <LocaleSwitch />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">{children}</main>
    </>
  );
}
