import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { cx } from '@/components/ui';

/**
 * A member's name — a link to their profile only when the viewer may open it.
 *
 * The profile page itself is what actually enforces this (see the guard in
 * members/[id]/page.tsx, and migration 0048 for why `members.directory` is a
 * separate permission from `members.view`). This component exists so that
 * nobody is handed a link that walks them into a refusal.
 *
 * The "you can always open your own profile" rule lives here rather than at
 * each call site, so it cannot be remembered in one place and forgotten in
 * another. The header avatar depends on it.
 */
export function MemberLink({
  id,
  viewerId,
  canOpenAny,
  className,
  children,
}: {
  id: string;
  /** The signed-in member's id, so they can always reach themselves. */
  viewerId?: string | null;
  /** Whether this viewer holds `members.directory`. */
  canOpenAny: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!canOpenAny && id !== viewerId) {
    return <span className={className}>{children}</span>;
  }

  return (
    <Link href={`/members/${id}`} className={cx(className, 'text-brand-700 hover:underline')}>
      {children}
    </Link>
  );
}
