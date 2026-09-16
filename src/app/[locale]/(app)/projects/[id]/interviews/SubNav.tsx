'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { cx } from '@/components/ui';

export type SubNavItem = {
  href: string;
  label: string;
  /** The overview: active only on its exact path, since every tab starts with it. */
  exact?: boolean;
};

/** The tabs across the top of the interviews pages. Scrolls sideways on a phone. */
export function SubNav({ items }: { items: SubNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="-mx-1 mb-5 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-line px-1">
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  '-mb-px inline-block whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-[color,border-color] duration-150',
                  active
                    ? 'border-brand-600 font-semibold text-brand-700'
                    : 'border-transparent font-medium text-ink-muted hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
