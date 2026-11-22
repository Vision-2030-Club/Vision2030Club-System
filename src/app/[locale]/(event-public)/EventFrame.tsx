import type { ReactNode } from 'react';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { QurooshPage } from '@/components/QurooshHero';
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
 *
 * Quroosh's pages take the identity's page design (`QurooshPage`): the navy
 * hero holds the page's `title` and `subtitle`, the body below is light.
 */
export function EventFrame({
  theme,
  name,
  title,
  subtitle,
  children,
}: {
  theme: EventTheme;
  /** The project's name in the page's language. */
  name: string;
  /** Quroosh only: the hero's heading (the project's name if left out) and the line under it. */
  title?: ReactNode;
  subtitle?: ReactNode;
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
      {theme === 'quroosh' ? (
        <div className="quroosh-type flex min-h-dvh flex-col">
          <QurooshPage name={name} title={title ?? name} subtitle={subtitle}>
            {children}
          </QurooshPage>
        </div>
      ) : (
        <>
          <header className="border-b border-line bg-surface">
            <div className="mx-auto flex max-w-xl items-center gap-4 px-4 py-4">
              <span className="min-w-0 truncate text-lg font-semibold text-ink">{name}</span>
              <div className="ms-auto rounded-lg bg-surface">
                <LocaleSwitch />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-xl px-4 py-6">{children}</main>
        </>
      )}
    </>
  );
}
