import Image from 'next/image';
import { cx } from '@/components/ui';

/**
 * The افترض mark: the wordmark, its tagline and the linked-badges glyph, as
 * the club supplied it — deep teal on nothing. `tone="white"` inverts it for
 * the dark waiting-area screen; the artwork is one flat colour, so a filter
 * gives a faithful white version without a second file. The `interviews-logo`
 * class is a hook for globals.css should a theme need to restyle the mark.
 */
export function InterviewsLogo({
  name,
  tone = 'brand',
  className,
}: {
  /** Alt text: the project this mark stands for. */
  name: string;
  tone?: 'brand' | 'white';
  className?: string;
}) {
  return (
    <Image
      src="/brand/interviews-logo.png"
      alt={name}
      width={4160}
      height={1049}
      priority
      className={cx(
        'interviews-logo h-8 w-auto max-w-full object-contain object-left rtl:object-right',
        tone === 'white' && 'brightness-0 invert',
        className,
      )}
    />
  );
}
