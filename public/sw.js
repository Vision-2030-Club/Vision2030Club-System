/*
 * Service worker for Vision Club 2030.
 *
 * Its one job is push: receive a notification, show it, and open the right
 * page when it is tapped. There is deliberately no offline caching — every
 * page is user-scoped and dynamic, and a cached page would be a stale one.
 *
 * Served from /sw.js (the proxy matcher skips dotted paths) so its scope is
 * the whole site, which is what an installed Home Screen app needs.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Vision Club 2030';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    // Same tag = the newer notification replaces the older one on the lock
    // screen instead of stacking. Used for reminders of the same event.
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  };

  // iOS requires every push to show something (userVisibleOnly); a push that
  // shows nothing gets the subscription silently revoked.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data && event.notification.data.url;
  const target = new URL(url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        // Reuse the open app if there is one — on iOS the installed app is a
        // single window, and opening a second one is not possible anyway.
        for (const client of windows) {
          if ('navigate' in client && client.url.startsWith(self.location.origin)) {
            return client.navigate(target).then((navigated) => (navigated || client).focus());
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
