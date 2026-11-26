'use client';

import { useState, type ReactNode } from 'react';
import { cx } from '@/components/ui';

/**
 * The two ways in on a guest's account page (Quroosh 0017): a new account,
 * or signing in to one they have. Both panels are rendered by the server and
 * handed in; this only chooses which shows. `?signin=1` on the page opens the
 * sign-in side (the sign-up form links there when an email already has an
 * account).
 */
export function StartTabs({
  initial,
  labels,
  signUp,
  signIn,
}: {
  initial: 'signup' | 'signin';
  labels: { label: string; signup: string; signin: string };
  signUp: ReactNode;
  signIn: ReactNode;
}) {
  const [tab, setTab] = useState(initial);
  const tabs = [
    { key: 'signup', label: labels.signup },
    { key: 'signin', label: labels.signin },
  ] as const;

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label={labels.label} className="flex gap-1 rounded-full border border-line bg-surface p-1 shadow-sm">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`start-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`start-panel-${key}`}
            onClick={() => setTab(key)}
            className={cx(
              'flex-1 rounded-full px-3 py-2.5 text-center text-sm font-semibold transition-colors',
              tab === key ? 'bg-brand-950 text-accent-2' : 'text-ink-muted hover:bg-surface-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Both stay in the tree, so what was typed survives switching back and forth. */}
      <div role="tabpanel" id="start-panel-signup" aria-labelledby="start-tab-signup" hidden={tab !== 'signup'}>
        {signUp}
      </div>
      <div role="tabpanel" id="start-panel-signin" aria-labelledby="start-tab-signin" hidden={tab !== 'signin'}>
        {signIn}
      </div>
    </div>
  );
}
