import type { MetadataRoute } from 'next';

/**
 * The web app manifest — what makes "Add to Home Screen" install the site as
 * an app rather than bookmark it. On iOS that installed state is the ONLY
 * one in which push notifications work, so this file is the first half of
 * the notification feature, not a cosmetic.
 *
 * Served at /manifest.webmanifest. Lives outside `[locale]` on purpose: the
 * manifest is one document for the whole site, and the proxy skips dotted
 * paths, so it is never rewritten under a locale.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // What "Add to Home Screen" pre-fills. Keep the two the same so the icon
    // reads identically on iOS (which uses the meta tag) and Android.
    name: 'Vision 2030 Club',
    short_name: 'Vision 2030 Club',
    description: 'Vision 2030 Club management system',
    // No locale prefix: the proxy resolves it from the NEXT_LOCALE cookie, so
    // the app opens in whichever language the person last used.
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#007a8f',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
