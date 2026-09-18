'use client';

import { useEffect, type ReactNode } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { NavIcon } from '@/components/NavIcons';
import { NavLinks, type NavItem } from '@/components/NavLinks';
import { cx } from '@/components/ui';

/** One project component's world: its pages, its name, where "back" goes. */
export type ComponentShell = {
  projectId: string;
  /** The project's name in the current language; the header mark shows it. */
  label: string;
  items: NavItem[];
  backHref: string;
  /** The header mark to show in place of the club logo. */
  logo: ReactNode;
};

/**
 * The signed-in shell, and the crossing between its two worlds.
 *
 * Everywhere in the club the header carries the club logo and the sidebar
 * lists the club's sections. Inside a project's Mock Interviews pages the
 * same header and sidebar — the same DOM, never remounted — show that
 * component's mark and only its pages, with a way back on top. Because the
 * nodes persist, the change can be animated: the logos cross-fade, the list
 * settles in, and `data-theme` on <html> lets the registered colour tokens in
 * globals.css glide from the club's teal to the component's violet.
 *
 * Which world we are in is read from the URL, so a direct load of an
 * interviews page is already in the right one (the root layout's inline
 * script sets the attribute before the first paint, and `theme-animate` is
 * only added afterwards so that load does not fade in from teal).
 */
export function AppShell({
  clubItems,
  components,
  menuLabel,
  backLabel,
  clubLogo,
  headerEnd,
  children,
}: {
  clubItems: NavItem[];
  components: ComponentShell[];
  menuLabel: string;
  backLabel: string;
  clubLogo: ReactNode;
  headerEnd: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active =
    components.find((component) => {
      const base = `/projects/${component.projectId}/interviews`;
      return pathname === base || pathname.startsWith(`${base}/`);
    }) ?? null;
  const inComponent = active !== null;

  useEffect(() => {
    const root = document.documentElement;
    if (inComponent) root.dataset.theme = 'interviews';
    else delete root.dataset.theme;
    // Enable the colour transition only once the first world has painted.
    const timer = window.setTimeout(() => root.classList.add('theme-animate'), 50);
    return () => window.clearTimeout(timer);
  }, [inComponent]);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          {/* Both marks are always in the tree; opacity decides which shows. */}
          <div className="relative h-8 w-44">
            <span
              aria-hidden={inComponent}
              className={cx(
                'absolute inset-y-0 start-0 flex items-center transition-opacity duration-500',
                inComponent ? 'opacity-0' : 'opacity-100',
              )}
            >
              {clubLogo}
            </span>
            {components.map((component) => (
              <span
                key={component.projectId}
                aria-hidden={active?.projectId !== component.projectId}
                className={cx(
                  'absolute inset-y-0 start-0 flex max-w-full items-center transition-opacity duration-500',
                  active?.projectId === component.projectId ? 'opacity-100 delay-150' : 'pointer-events-none opacity-0',
                )}
              >
                {component.logo}
              </span>
            ))}
          </div>

          <div className="ms-auto">{headerEnd}</div>
        </div>
      </header>

      {/*
        The sidebar is the FIRST child of this row, so `dir` on <html> decides
        which edge it hugs: left for English, right for Arabic. `min-w-0` on
        <main> keeps wide tables scrolling inside themselves instead of
        stretching the row.
      */}
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row">
        <aside className="lg:w-60 lg:shrink-0">
          <div className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
            {/* A new key per world: the old list leaves, the new one fades in. */}
            <div key={active?.projectId ?? 'club'} className="shell-fade">
              {active ? (
                <Link
                  href={active.backHref}
                  className="mb-2 flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink-muted transition-[background-color,color] duration-150 hover:bg-surface-muted hover:text-ink"
                >
                  <NavIcon name="back" className="size-5 shrink-0 rtl:rotate-180" />
                  {backLabel}
                </Link>
              ) : null}
              <NavLinks items={active ? active.items : clubItems} menuLabel={active ? active.label : menuLabel} />
            </div>
          </div>
        </aside>

        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
