'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * A read-only link with a Copy button. Links here are secrets (a company's
 * interviewer page, the TV), so they are shown, not linked: a click would
 * open them in the manager's own session and leave them in the history.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const t = useTranslations('interviews');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers: the field is selectable, so the person can copy by hand.
    }
  }

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-muted">{label}</div>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          dir="ltr"
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="ltr-nums min-w-0 flex-1 rounded-lg border border-line bg-surface-muted px-3 py-1.5 text-xs text-ink"
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-lg border border-line px-3 text-xs font-medium text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
    </div>
  );
}
