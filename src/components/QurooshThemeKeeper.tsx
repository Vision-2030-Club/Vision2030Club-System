'use client';

import { useEffect } from 'react';

/**
 * Keeps `data-theme="quroosh"` on <html> for the Quroosh guest pages.
 *
 * The root layout's inline script sets it before the first paint, but only
 * on a full page load. Switching language (LocaleSwitch) re-renders <html>
 * without a reload and the attribute was lost, so the page fell back to the
 * club's colours. This puts it back after every render of a guest page.
 */
export function QurooshThemeKeeper() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'quroosh');
  });
  return null;
}
