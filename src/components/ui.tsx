import type { ComponentProps, ReactNode } from 'react';

/**
 * Small shared building blocks. Everything here uses Tailwind's LOGICAL
 * utilities (ps/pe/ms/me/text-start) rather than left/right, so the same
 * markup lays out correctly in Arabic (RTL) and English (LTR).
 */

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'rounded-xl border border-line bg-surface p-5 shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonProps) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    secondary: 'border border-line bg-surface text-ink hover:bg-surface-muted',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'text-brand-600 hover:bg-brand-50',
  }[variant];

  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        styles,
        className,
      )}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink">
      {children}
    </label>
  );
}

const fieldStyles =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink ' +
  'outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 ' +
  'disabled:bg-surface-muted';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cx(fieldStyles, className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cx(fieldStyles, className)} rows={props.rows ?? 4} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={cx(fieldStyles, className)} />;
}

export function Alert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'warn' | 'ok' | 'info';
  children: ReactNode;
}) {
  const styles = {
    danger: 'border-danger/30 bg-danger/5 text-danger',
    warn: 'border-warn/30 bg-warn/5 text-warn',
    ok: 'border-ok/30 bg-ok/5 text-ok',
    info: 'border-brand-200 bg-brand-50 text-brand-700',
  }[tone];

  return (
    <div className={cx('rounded-lg border px-3 py-2 text-sm', styles)}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';
}) {
  const styles = {
    neutral: 'bg-surface-muted text-ink-muted',
    brand: 'bg-brand-50 text-brand-700',
    ok: 'bg-ok/10 text-ok',
    warn: 'bg-warn/10 text-warn',
    danger: 'bg-danger/10 text-danger',
  }[tone];

  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        styles,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-ink-muted">
      {children}
    </div>
  );
}

/** IDs and phone numbers read left-to-right even inside Arabic text. */
export function Numeric({ children }: { children: ReactNode }) {
  return <span className="ltr-nums">{children}</span>;
}
