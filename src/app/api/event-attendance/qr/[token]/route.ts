import QRCode from 'qrcode';
import { PASS_TOKEN, passUrl } from '@/lib/eventAttendance/links';

/**
 * GET /api/event-attendance/qr/<token>: a pass's QR code as a PNG, for the
 * pass email (mail apps block the inline data URL the pass page uses).
 *
 * It draws whatever token it is given and looks nothing up: the picture
 * holds only the pass link, which the asker already has, so it says nothing
 * about whether the pass exists or whose it is.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!PASS_TOKEN.test(token)) return new Response('Not found', { status: 404 });

  const png = await QRCode.toBuffer(passUrl('ar', token), { errorCorrectionLevel: 'M', margin: 2, width: 480 });
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      // The same token always draws the same picture.
      'Cache-Control': 'public, max-age=86400, immutable',
      'X-Robots-Tag': 'noindex',
    },
  });
}
