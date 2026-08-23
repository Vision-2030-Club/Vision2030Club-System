import type { ReactNode } from 'react';
import { cx } from '@/components/ui';

/**
 * A horizontal bar chart, built from HTML rather than SVG.
 *
 * Two reasons. RTL: bars must grow from the right in Arabic, and logical
 * properties do that for free where an SVG would need mirrored viewBox maths.
 * Responsiveness: percentage widths reflow inside the KPI grid without a
 * measured pixel scale.
 *
 * Every row is directly labelled with its own name and value, so identity
 * never rests on hue — which is what lets the risk tiers use a same-family
 * severity ramp (yellow → orange → red → dark red) without the colours needing
 * to be tellable apart on their own.
 */
export type BarRow = {
  key: string;
  label: string;
  /** Bar length. Always non-negative. */
  value: number;
  /** What to print at the end of the row — "72.5%", "3 tasks", … */
  display: string;
  color: string;
  /** Small print under the label. */
  meta?: string;
  /** Wraps the label, e.g. in a Link. */
  labelWrapper?: (label: ReactNode) => ReactNode;
};

export function BarList({
  rows,
  max,
  emptyText,
  caption,
}: {
  rows: BarRow[];
  /** Shared scale across rows. Defaults to the largest value present. */
  max?: number;
  emptyText: string;
  caption?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-muted">{emptyText}</p>;
  }

  const scale = Math.max(max ?? Math.max(...rows.map((r) => r.value)), 1);

  return (
    <div>
      <ul className="space-y-2.5">
        {rows.map((row) => {
          // A non-zero value always shows a sliver, so "small" never reads as
          // "none"; a real zero stays empty.
          const pct = row.value <= 0 ? 0 : Math.max((row.value / scale) * 100, 1.5);
          const label = (
            <span className="truncate text-ink" title={row.label}>
              {row.label}
            </span>
          );

          return (
            <li key={row.key} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="min-w-0 truncate">
                {row.labelWrapper ? row.labelWrapper(label) : label}
                {row.meta ? (
                  <span className="block truncate text-xs text-ink-muted">{row.meta}</span>
                ) : null}
              </span>

              <span className="h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
                <span
                  className="block h-full rounded-full transition-[width]"
                  style={{ width: `${pct}%`, backgroundColor: row.color }}
                  // Native hover text; the row is direct-labelled either way.
                  title={`${row.label}: ${row.display}`}
                />
              </span>

              {/* Values wear ink, never the series colour. */}
              <span className="tabular-nums text-ink-muted">{row.display}</span>
            </li>
          );
        })}
      </ul>

      {caption ? <p className="mt-3 text-xs text-ink-muted">{caption}</p> : null}
    </div>
  );
}

/** A single headline figure. Not every number deserves a chart. */
export function StatTile({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger';
  hint?: string;
}) {
  const toneClass = {
    neutral: 'text-ink',
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
  }[tone];

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', toneClass)}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-ink-muted">{hint}</div> : null}
    </div>
  );
}
