import { cx } from '@/components/ui';
import { initials } from '@/lib/avatars';

/**
 * A member's photo, or their initials when there is none.
 *
 * Deliberately a plain <img> rather than next/image: the src is a short-lived
 * signed URL from a private bucket (see src/lib/avatars.ts), so the optimiser
 * would be caching a URL that expires — and pointing `remotePatterns` at the
 * Supabase host would let any URL on that host through the optimiser too.
 */
export function Avatar({
  src,
  name,
  size = 40,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };

  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      style={style}
      className={cx('shrink-0 rounded-full object-cover', className)}
    />
  ) : (
    <span
      aria-hidden
      style={{ ...style, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full',
        'bg-brand-50 font-semibold text-brand-700',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
