import 'server-only';
import QRCode from 'qrcode';
import { siteUrl } from '@/lib/site';

/** Mirrors `short_links_slug_shape` in migration 0068. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type ShortLink = {
  slug: string;
  label: string;
  target_url: string;
  visits: number;
  updated_at: string;
};

/** The address that gets printed: `https://<site>/go/<slug>`. */
export function shortLinkUrl(slug: string): string {
  return `${siteUrl()}/go/${slug}`;
}

/**
 * The QR code for a short link, twice: an SVG for the page and for print,
 * and a large PNG for the places that want a picture (a slide, WhatsApp).
 *
 * Both are data URLs, so the page needs no extra route and no client code —
 * an <img> shows the SVG, and an <a download> hands either file over.
 * Error correction M survives a logo-free poster at a distance; a quiet zone
 * of two modules is what scanners expect.
 */
export async function qrDataUrls(text: string): Promise<{ svg: string; png: string }> {
  const [svg, png] = await Promise.all([
    QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }),
    QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: 1024 }),
  ]);
  return { svg: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, png };
}
