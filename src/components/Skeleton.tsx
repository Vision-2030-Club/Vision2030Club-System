import { Card, cx } from '@/components/ui';

/**
 * Placeholder shapes for `loading.tsx`.
 *
 * Every page here is user-scoped and therefore fully dynamic — it cannot be
 * cached, and its data cannot be prefetched. Without a loading boundary that
 * meant a navigation showed the OLD page until every query finished, so the
 * app felt frozen on each click even when the work took under a second.
 *
 * These render instantly, which lets the shell and the sidebar paint while the
 * page's own queries are still running.
 *
 * `prefers-reduced-motion` turns the shimmer off; a pulsing block is exactly
 * the kind of thing that setting exists for.
 */
export function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'block rounded bg-surface-muted motion-safe:animate-pulse',
        className,
      )}
    />
  );
}

/** A page heading placeholder, matching PageHeader's rhythm. */
export function SkeletonHeader() {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="w-full max-w-sm">
        <Shimmer className="h-7 w-48" />
        <Shimmer className="mt-2 h-4 w-64" />
      </div>
      <Shimmer className="h-9 w-28 rounded-lg" />
    </div>
  );
}

/** A stack of card placeholders, for list-shaped pages. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i}>
          <div className="flex items-center gap-3">
            <Shimmer className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Shimmer className="h-4 w-1/3" />
              <Shimmer className="mt-2 h-3 w-1/2" />
            </div>
            <Shimmer className="h-6 w-16 shrink-0 rounded-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/** A grid of card placeholders, for dashboard-shaped pages. */
export function SkeletonCards({ cards = 3 }: { cards?: number }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {Array.from({ length: cards }, (_, i) => (
        <Card key={i}>
          <Shimmer className="h-4 w-32" />
          <div className="mt-4 space-y-2.5">
            <Shimmer className="h-3 w-full" />
            <Shimmer className="h-3 w-5/6" />
            <Shimmer className="h-3 w-2/3" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * The whole page, ready to drop into a `loading.tsx`.
 *
 * Announced politely so a screen-reader user is told the page is loading
 * rather than being handed a silent screen of decorative boxes.
 */
export function SkeletonPage({
  shape = 'list',
  rows,
}: {
  shape?: 'list' | 'cards';
  rows?: number;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <SkeletonHeader />
      {shape === 'cards' ? <SkeletonCards cards={rows ?? 3} /> : <SkeletonList rows={rows ?? 4} />}
    </div>
  );
}
