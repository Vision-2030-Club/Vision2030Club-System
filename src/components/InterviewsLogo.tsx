import { NavIcon } from '@/components/NavIcons';

/**
 * The Mock Interviews mark in the header: the component's glyph beside the
 * project's own name, drawn in the current brand colour so it turns violet
 * with the rest of the shell. No image file exists for it yet — when the
 * club has one, replace this with an `<Image>` of the same height and keep
 * the `name` as its alt text.
 */
export function InterviewsLogo({ name }: { name: string }) {
  return (
    <span className="flex h-8 items-center gap-2 text-brand-700" aria-label={name}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
        <NavIcon name="interviews" className="size-5" />
      </span>
      <span className="truncate font-latin text-base font-bold leading-none tracking-tight">{name}</span>
    </span>
  );
}
