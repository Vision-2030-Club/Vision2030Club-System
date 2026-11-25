import { cx } from '@/components/ui';

/** Gold, silver and bronze for the first three places. */
export const MEDALS = [
  { face: 'fill-medal-gold', rim: 'stroke-medal-gold-rim', strip: 'border-s-medal-gold' },
  { face: 'fill-medal-silver', rim: 'stroke-medal-silver-rim', strip: 'border-s-medal-silver' },
  { face: 'fill-medal-bronze', rim: 'stroke-medal-bronze-rim', strip: 'border-s-medal-bronze' },
] as const;

/**
 * A medal for places 1–3: two ribbon tails in the identity's purple and mint,
 * and a metal disc with the place on it. The place is still read out as text.
 * Shared by the guests' leaderboard and the Final Wave's.
 */
export function Medal({ place }: { place: number }) {
  const medal = MEDALS[place - 1];
  return (
    <svg viewBox="0 0 36 40" className="h-10 w-9 shrink-0" role="img" aria-label={String(place)}>
      <path d="M9 0h7l4 14h-7z" className="fill-coin" />
      <path d="M27 0h-7l-4 14h7z" className="fill-accent" />
      <circle cx="18" cy="24" r="13" className={cx(medal.face, medal.rim)} strokeWidth="2.5" />
      <circle cx="18" cy="24" r="9" fill="none" className={medal.rim} strokeWidth="1" strokeOpacity="0.6" />
      <text
        x="18"
        y="24"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-brand-950 text-[13px] font-bold"
        aria-hidden="true"
      >
        {place}
      </text>
    </svg>
  );
}
