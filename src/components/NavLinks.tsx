'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { cx } from '@/components/ui';

export type NavItem = {
  href: string;
  label: string;
  show: boolean;
};

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="mx-auto max-w-7xl overflow-x-auto px-4">
      <ul className="flex gap-1 whitespace-nowrap">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cx(
                  'inline-block border-b-2 px-3 py-2 text-sm font-medium transition',
                  active
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-ink-muted hover:text-ink',
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
