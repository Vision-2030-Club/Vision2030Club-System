import { NextResponse, type NextRequest } from 'next/server';
import { CONTENT_TYPES, LOGO_BUCKET, LOGO_PATH } from '@/lib/interviews/logo';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';

/**
 * Serves one company logo from the private `logos` bucket (lib/interviews/logo.ts).
 * Public on purpose: the apply form shows logos to anyone. Only paths of the
 * exact shape uploadLogo writes are served, only as the image types the
 * bucket accepts, and every upload gets a new name, so a response can be
 * cached forever.
 */
export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path') ?? '';
  if (!isInterviewsConfigured() || !LOGO_PATH.test(path)) return notFound();

  const db = createInterviewsClient();
  const { data, error } = await db.storage.from(LOGO_BUCKET).download(path);
  if (error || !data) return notFound();

  const ext = path.slice(path.lastIndexOf('.') + 1);
  return new NextResponse(data, {
    headers: {
      'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
