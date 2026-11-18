import 'server-only';
import { after } from 'next/server';
import QRCode from 'qrcode';
import { createAdminClient } from '@/lib/supabase/admin';
import { eventDayRange, passQrImageUrl, passUrl } from '@/lib/eventAttendance/links';

/**
 * Sending the pass emails the club database queued (0075).
 *
 * Signing up (or another component registering somebody) writes a row to
 * `event_pass_outbox`. This file turns each row into a message in the
 * person's language, with their QR code in it and attached as a picture, and
 * sends it through Resend with a plain HTTP call, the way the interviews'
 * emails go (src/lib/interviews/email.ts).
 *
 * Two entry points: the action that queued the row kicks a pass after its
 * response is sent, and the club's five-minute sweep (/api/push/cron)
 * retries whatever remains. `event_claim_passes` leases rows, so the two
 * never send the same one.
 *
 * Without RESEND_API_KEY and EMAIL_FROM nothing is sent and nothing is lost:
 * the rows wait, and the component's first page says how many.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const CONCURRENCY = 4;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

type PassRow = {
  id: string;
  to_email: string;
  to_name: string;
  locale: 'ar' | 'en';
  token: string;
  project_id: string;
  name_en: string;
  name_ar: string;
  first_day: string | null;
  last_day: string | null;
};

export type PassReport = { claimed: number; sent: number; failed: number; deferred: number };

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render(row: PassRow): { subject: string; html: string; text: string } {
  const ar = row.locale !== 'en';
  const event = ar ? row.name_ar : row.name_en;
  const days = eventDayRange(row.first_day, row.last_day, ar ? 'ar' : 'en');
  const href = passUrl(ar ? 'ar' : 'en', row.token);

  const subject = ar ? `رمز دخولك إلى ${event}` : `Your pass for ${event}`;
  const lines = ar
    ? [
        `مرحبًا ${row.to_name}،`,
        `تم تسجيلك في ${event}. هذا رمز الدخول الخاص بك.`,
        days ? `أيام الفعالية: ${days}.` : '',
        'أظهر الرمز لموظف البوابة عند الدخول، في كل يوم تحضر فيه. الرمز خاص بك، فلا تشاركه مع أحد.',
      ]
    : [
        `Hello ${row.to_name},`,
        `You are registered for ${event}. This is your personal pass.`,
        days ? `Event days: ${days}.` : '',
        'Show the code to the staff at the gate each day you attend. It is yours alone, so please do not share it.',
      ];
  const button = ar ? 'فتح رمز الدخول' : 'Open my pass';
  const alt = ar ? 'رمز الدخول' : 'Your pass';
  const paragraphs = lines.filter(Boolean);

  const body = paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.6">${escapeHtml(p)}</p>`).join('');
  const html =
    `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">` +
    `<body style="margin:0;background:#f6f8f9;font-family:'IBM Plex Sans Arabic',Segoe UI,Arial,sans-serif;color:#0f172a">` +
    `<div style="max-width:560px;margin:0 auto;padding:32px 20px">` +
    `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">` +
    `<h1 style="margin:0 0 16px;font-size:20px;color:#076174">${escapeHtml(subject)}</h1>${body}` +
    `<p style="margin:20px 0;text-align:center"><img src="${escapeHtml(passQrImageUrl(row.token))}" width="240" height="240" alt="${escapeHtml(alt)}" style="display:inline-block;border:1px solid #e2e8f0;border-radius:8px"></p>` +
    `<p style="margin:20px 0;text-align:center"><a href="${escapeHtml(href)}" style="display:inline-block;background:#007a8f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(button)}</a></p>` +
    `<p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">${escapeHtml(href)}</p>` +
    `</div><p style="margin:16px 0 0;font-size:12px;color:#64748b;text-align:center">Vision 2030 Club · نادي رؤية 2030</p></div></body></html>`;
  const text = [subject, '', ...paragraphs, '', `${button}: ${href}`].join('\n');
  return { subject, html, text };
}

async function send(row: PassRow): Promise<{ id: string } | { error: string }> {
  const rendered = render(row);
  // The same code as on the pass page, attached so it can be saved or shown
  // offline, and so it is there when a mail app hides remote pictures.
  const png = await QRCode.toBuffer(passUrl(row.locale === 'en' ? 'en' : 'ar', row.token), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 720,
  });
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      // A comma or a quote in a display name would break the address.
      to: [`${row.to_name.replace(/[<>",;]/g, ' ').trim()} <${row.to_email}>`],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments: [{ filename: 'pass.png', content: png.toString('base64') }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!response.ok || !body.id) {
    return { error: `${response.status} ${body.message ?? body.name ?? 'Resend refused the message'}` };
  }
  return { id: body.id };
}

/**
 * Sends the queued passes. Safe to call from anywhere: with nothing queued
 * it does nothing, without a key it leaves every row where it is, and before
 * migration 0075 is applied it finds no function and returns quietly.
 */
export async function deliverPendingPasses(limit = 50, budgetMs = 30_000): Promise<PassReport> {
  const started = Date.now();
  const report: PassReport = { claimed: 0, sent: 0, failed: 0, deferred: 0 };
  if (!isEmailConfigured()) return report;

  const db = createAdminClient();
  const { data, error } = await db.rpc('event_claim_passes', { p_limit: limit });
  if (error) return report;

  const queue = (data ?? []) as PassRow[];
  report.claimed = queue.length;

  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      // Left leased: the next sweep takes it once the lease runs out.
      if (Date.now() - started > budgetMs) {
        report.deferred += 1;
        continue;
      }
      let outcome: { id: string } | { error: string };
      try {
        outcome = await send(row);
      } catch (caught) {
        outcome = { error: caught instanceof Error ? caught.message : 'Unknown error' };
      }
      if ('id' in outcome) report.sent += 1;
      else report.failed += 1;
      await db.rpc('event_pass_result', {
        p_id: row.id,
        p_provider_id: 'id' in outcome ? outcome.id : null,
        p_error: 'error' in outcome ? outcome.error : null,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return report;
}

/** For the end of a server action: send once the response is out the door. */
export function kickPassDelivery(): void {
  after(async () => {
    try {
      await deliverPendingPasses();
    } catch (error) {
      console.error('[event-attendance/email] delivery failed', error);
    }
  });
}
