import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseEnv } from '@/lib/supabase/env';
import { SLUG_PATTERN } from '@/lib/links';

/**
 * `/go/<slug>`: the address printed on a poster or inside a QR code.
 *
 * The code is the address, and the address is this route; where it leads is a
 * row in `short_links` that the admin page edits. So the redirect must never
 * be cached — a 307 with `no-store`, never a 301 — or a browser that followed
 * it once would keep following the old destination after the row changes.
 *
 * Anonymous by design: whoever scans the code has no account. The proxy skips
 * `/go/`, and the client here carries the anon key and no cookies; the only
 * thing it can do is call `resolve_short_link`, which hands back one address
 * and counts the visit.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const headers = { 'Cache-Control': 'no-store' };

  // Scanners keep the case; a hand-typed address may not.
  const key = slug.toLowerCase();
  if (!SLUG_PATTERN.test(key)) return notFound(headers);

  const { url, anonKey } = supabaseEnv();
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('resolve_short_link', { p_slug: key });
  if (error || typeof data !== 'string') return notFound(headers);

  return NextResponse.redirect(data, { status: 307, headers });
}

/** A short bilingual page for a code nobody owns any more. */
function notFound(headers: Record<string, string>) {
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>الرابط غير موجود · Link not found</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #f7f7f5; color: #1c1c1a; }
  main { padding: 32px 24px; text-align: center; max-width: 28rem; }
  p { margin: 8px 0; line-height: 1.6; }
</style>
</head>
<body>
<main>
<p>هذا الرابط لم يعد يعمل. اطلب الرابط الصحيح من نادي رؤية 2030.</p>
<p dir="ltr">This link no longer works. Ask Vision 2030 Club for the current one.</p>
</main>
</body>
</html>`;
  return new NextResponse(html, {
    status: 404,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  });
}
