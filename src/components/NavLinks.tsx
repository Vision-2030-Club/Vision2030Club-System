'use client';

import { useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { cx } from '@/components/ui';
import { NavIcon, type NavIconName } from '@/components/NavIcons';

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  show: boolean;
};

/**
 * The primary menu, rendered as a vertical list.
 *
 * Placement is driven entirely by `<html dir>` (set in the locale layout):
 * the sidebar is the first flex child, so it lands on the inline START —
 * left in English, right in Arabic — with no locale check in here. Same
 * reason the icon sits before the label via `gap` rather than a margin.
 *
 * Below `lg` there is no room for a sidebar, so the list collapses behind a
 * toggle and the same markup is reused as a dropdown panel.
 */
export function NavLinks({
  items,
  menuLabel,
}: {
  items: NavItem[];
  menuLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  /*
   * The longest matching href is the active one. A component's button points
   * INSIDE a project (/projects/<id>/interviews), so without this both it and
   * "Projects" would light up at once.
   */
  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mb-2 flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink lg:hidden"
      >
        <NavIcon name="menu" className="size-5 shrink-0 text-ink-muted" />
        {menuLabel}
      </button>

      <nav className={cx(open ? 'block' : 'hidden', 'lg:block')}>
        <ul className="space-y-1 rounded-xl border border-line bg-surface p-2 shadow-sm">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition',
                    active
                      ? 'bg-brand-50 font-semibold text-brand-700'
                      : 'font-medium text-ink-muted hover:bg-surface-muted hover:text-ink',
                  )}
                >
                  <NavIcon
                    name={item.icon}
                    className={cx(
                      'size-5 shrink-0',
                      active ? 'text-brand-600' : 'text-ink-muted',
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
