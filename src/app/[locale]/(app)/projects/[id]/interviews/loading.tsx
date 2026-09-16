import { SkeletonCards } from '@/components/Skeleton';

/**
 * Below the tabs while an interviews page fetches from the second database.
 * The layout above (header and tabs) is already painted, so only the content
 * area shimmers.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <SkeletonCards cards={3} />
    </div>
  );
}
