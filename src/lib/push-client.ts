/**
 * Browser-side facts about push, shared by the settings card, the dashboard
 * nudge and the service-worker registration. No server imports here.
 */

export const SERVICE_WORKER_URL = '/sw.js';

/** iPhone and iPad — including the iPad that reports itself as a Mac. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
  );
}

/** Opened from the Home Screen icon, not from a Safari tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's own flag, older than the media query.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Registers the worker (idempotent) and returns the active registration. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: '/',
    // Always check the network for a new worker, so a deploy that changes
    // sw.js reaches installed apps on their next open.
    updateViaCache: 'none',
  });
  return navigator.serviceWorker.ready;
}

/** VAPID public keys are URL-safe base64; `subscribe` wants raw bytes. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
