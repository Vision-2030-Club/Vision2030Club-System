'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Card } from '@/components/ui';

/**
 * A "New X +" button that reveals a form, instead of a form parked open on the
 * page.
 *
 * The panel's children are rendered by the SERVER and passed in — this
 * component only decides whether they are in the tree. That keeps the forms
 * inside it (which need teams, projects and members loaded from the database)
 * server components, and means opening the panel costs no request.
 */
export function Disclosure({
  label,
  title,
  children,
  className,
}: {
  /** Button text. The `+` is added here so every caller matches. */
  label: string;
  /** Heading shown above the revealed panel. Defaults to the button text. */
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} className={className}>
        {label} +
      </Button>
    );
  }

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title ?? label}</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('close')}
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted hover:bg-surface-muted"
        >
          ✕
        </button>
      </div>
      {children}
    </Card>
  );
}
