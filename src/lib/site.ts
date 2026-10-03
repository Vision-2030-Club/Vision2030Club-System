/**
 * The address the site is reached at, for every link that leaves the app:
 * emails, the interviews' public links, and the short links behind QR codes.
 *
 * `SITE_URL` if set, else Vercel's own production address, else the project's
 * known one. If the club moves to its own domain, set `SITE_URL` in Vercel —
 * and remember a printed QR code keeps the address it was printed with.
 */
export function siteUrl(): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const url = process.env.SITE_URL || (vercel ? `https://${vercel}` : 'https://vision2030club-system.vercel.app');
  return url.replace(/\/$/, '');
}
