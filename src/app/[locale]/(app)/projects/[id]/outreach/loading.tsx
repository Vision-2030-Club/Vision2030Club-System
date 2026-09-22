import { SkeletonCards } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <SkeletonCards cards={3} />
    </div>
  );
}
