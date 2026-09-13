'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The header's person: press the photo and name, and a short menu drops —
 * the profile, the language, sign out. Those used to sit in a row beside
 * the name, which on a phone was three targets fighting for one corner.
 *
 * The items are rendered by the server layout and handed in, so the
 * sign-out form keeps its server action and the profile link its typed
 * route; this component only owns open/closed. Closing on a click elsewhere
 * is a document-level subscription, the same shape as ActionsMenu.
 */
export function ProfileMenu({
  trigger,
  label,
  children,
}: {
  trigger: ReactNode;
  /** Accessible name for the button — "Menu". */
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-3 rounded-lg px-1 py-0.5 text-start hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {trigger}
        <span aria-hidden className="text-xs text-ink-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          // Any tap inside closes it too: every item navigates or submits.
          onClick={() => setOpen(false)}
          className="absolute end-0 z-30 mt-1 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
