'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, cx } from '@/components/ui';

export type MenuPanel = {
  /** Stable key, also used as the button's id. */
  key: string;
  label: string;
  /** Rendered on the server and handed in — see the note on Disclosure. */
  content: ReactNode;
};

/**
 * An "Actions" button that drops a short menu, each item opening one panel
 * below it.
 *
 * Replaces a profile page that used to be a column of permanently-open forms.
 * Only one panel is open at a time, so the page reads as a profile with a menu
 * rather than as a settings screen.
 *
 * Placement uses logical properties (`end-0`), so the menu hangs off the same
 * edge as the button under both `dir=ltr` and `dir=rtl` without a locale check.
 */
export function ActionsMenu({
  label,
  panels,
}: {
  label: string;
  panels: MenuPanel[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  /*
   * A dropdown has to close when attention moves elsewhere, and "elsewhere" is
   * the document — outside React's tree — so this is a real external
   * subscription rather than state that could be derived.
   */
  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const openPanel = panels.find((panel) => panel.key === active);

  return (
    <div className="mb-4 space-y-3">
      <div ref={wrapperRef} className="relative flex justify-end">
        <Button
          type="button"
          variant="secondary"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((value) => !value)}
        >
          {label}
          <span aria-hidden className="text-xs">
            ▾
          </span>
        </Button>

        {menuOpen ? (
          <div
            role="menu"
            className="absolute end-0 z-20 mt-1 min-w-52 rounded-lg border border-line bg-surface p-1 shadow-lg"
          >
            {panels.map((panel) => (
              <button
                key={panel.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  // Clicking the open panel's item closes it again.
                  setActive((current) => (current === panel.key ? null : panel.key));
                  setMenuOpen(false);
                }}
                className={cx(
                  'block w-full rounded px-3 py-2 text-start text-sm',
                  active === panel.key
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-ink hover:bg-surface-muted',
                )}
              >
                {panel.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {openPanel ? openPanel.content : null}
    </div>
  );
}
