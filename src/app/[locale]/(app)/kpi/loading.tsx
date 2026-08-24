import { SkeletonPage } from '@/components/Skeleton';

/**
 * Shown while /kpi fetches. Without this the browser held the previous
 * page on screen until every query returned, which is what made the app
 * feel like it was ignoring clicks.
 */
export default function Loading() {
  return <SkeletonPage shape="cards" />;
}
