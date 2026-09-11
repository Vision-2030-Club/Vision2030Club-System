'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';
import { isPushSupported, registerServiceWorker } from '@/lib/push-client';
import { touchPushSubscriptionAction } from '@/app/[locale]/(app)/members/[id]/push-actions';

/**
 * Runs once per app open, from the signed-in shell.
 *
 * Registering here (and not only on the profile card) means a changed sw.js
 * reaches every installed app the next time it is opened, and a device that
 * is subscribed reports in — which is how the server learns the language it
 * should write that device's notifications in.
 */
export function RegisterServiceWorker() {
  const locale = useLocale();

  useEffect(() => {
    if (!isPushSupported()) return;

    void registerServiceWorker()
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (subscription) return touchPushSubscriptionAction(subscription.endpoint, locale);
      })
      .catch(() => {
        // A worker that fails to register only means no push on this device.
        // Nothing else in the app depends on it.
      });
  }, [locale]);

  return null;
}
