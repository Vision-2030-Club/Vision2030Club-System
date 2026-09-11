'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@/components/ui';
import {
  isIOS,
  isPushSupported,
  isStandalone,
  registerServiceWorker,
  urlBase64ToUint8Array,
} from '@/lib/push-client';
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from '@/app/[locale]/(app)/members/[id]/push-actions';

/**
 * The card on a member's own profile that turns notifications on.
 *
 * Every state here is one Safari on iOS can be in:
 *
 *   not-installed  the site is open in a Safari tab. Push does not exist
 *                  there; the only way forward is Add to Home Screen, so
 *                  that is what the card says.
 *   denied         they tapped "Don't Allow" once. iOS never asks again for
 *                  the same installed app; the fix is to reinstall it.
 *   ready          installed, not yet subscribed. The button is the ONLY
 *                  thing that calls requestPermission — iOS ignores a
 *                  request that is not inside a tap.
 *   subscribed     this device will get pushes. Offers a test and an off.
 */
type Phase =
  | 'checking'
  | 'unsupported'
  | 'not-installed'
  | 'denied'
  | 'ready'
  | 'subscribed';

export function PushSettings() {
  const t = useTranslations('push');
  const locale = useLocale();

  const [phase, setPhase] = useState<Phase>('checking');
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (isIOS() && !isStandalone()) return setPhase('not-installed');
      if (!isPushSupported()) return setPhase('unsupported');
      if (Notification.permission === 'denied') return setPhase('denied');

      try {
        const registration = await registerServiceWorker();
        const existing = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setSubscription(existing);
        setPhase(existing ? 'subscribed' : 'ready');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('unsupported');
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      // Must happen synchronously inside the tap on iOS — no awaits before it.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPhase(permission === 'denied' ? 'denied' : 'ready');
        return;
      }

      const registration = await registerServiceWorker();
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });

      const json = sub.toJSON();
      const result = await savePushSubscriptionAction({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
        locale,
        userAgent: navigator.userAgent,
      });

      if (!result.ok) {
        await sub.unsubscribe();
        setError(result.error ?? t('unexpected'));
        return;
      }

      setSubscription(sub);
      setPhase('subscribed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!subscription) return;
    setBusy(true);
    setError(null);
    try {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await removePushSubscriptionAction(endpoint);
      setSubscription(null);
      setTestResult(null);
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await sendTestPushAction();
      if (!result.ok) {
        setError(result.error ?? t('unexpected'));
      } else {
        setTestResult(t('testSent', { count: result.delivered }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">{t('intro')}</p>

      {phase === 'checking' ? (
        <p className="text-sm text-ink-muted">{t('checking')}</p>
      ) : null}

      {phase === 'unsupported' ? <Alert tone="warn">{t('unsupported')}</Alert> : null}

      {phase === 'not-installed' ? (
        <div className="rounded-lg border border-line bg-surface-muted p-3 text-sm">
          <p className="font-medium text-ink">{t('installTitle')}</p>
          <p className="mt-1 text-ink-muted">{t('installSteps')}</p>
        </div>
      ) : null}

      {phase === 'denied' ? <Alert tone="warn">{t('deniedText')}</Alert> : null}

      {phase === 'ready' ? (
        <Button type="button" onClick={enable} disabled={busy}>
          {busy ? t('enabling') : t('enable')}
        </Button>
      ) : null}

      {phase === 'subscribed' ? (
        <>
          <Alert tone="ok">{t('enabledOn')}</Alert>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={sendTest} disabled={busy}>
              {t('sendTest')}
            </Button>
            <Button type="button" variant="ghost" onClick={disable} disabled={busy}>
              {t('disable')}
            </Button>
          </div>
          {testResult ? <p className="text-sm text-ink-muted">{testResult}</p> : null}
        </>
      ) : null}

      {error ? <Alert tone="danger">{t('failed', { error })}</Alert> : null}
    </div>
  );
}
