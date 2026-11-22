import 'server-only';
import { after } from 'next/server';
import QRCode from 'qrcode';
import { createAdminClient } from '@/lib/supabase/admin';
import { eventDayRange, passQrImageUrl, passUrl } from '@/lib/eventAttendance/links';
import type { EventTheme } from '@/lib/eventAttendance/types';
import { siteUrl } from '@/lib/site';

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

function render(row: PassRow, theme: EventTheme = null): { subject: string; html: string; text: string } {
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
  const text = [subject, '', ...paragraphs, '', `${button}: ${href}`].join('\n');

  if (theme === 'quroosh') {
    return { subject, html: renderQuroosh({ ar, subject, paragraphs, button, alt, href, token: row.token }), text };
  }

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
  return { subject, html, text };
}

/**
 * The pass email of an event that wears Quroosh's identity, in the identity's
 * page design (QurooshPage on the site): a navy hero with the logo ("Powered
 * by RAYH"), a pair of the identity's purple coins (tilted as on the site),
 * the title and the greeting; a wave into a
 * light lavender body; a white card with the message, the QR on its own tile
 * and the purple button; a quiet note; a navy wave closing it. Built from
 * tables with inline styles and bgcolor, the form mail apps keep; the
 * pictures are PNGs on the site (public/brand/quroosh-email-*), since mail
 * apps drop SVG and CSS rotation.
 */
function renderQuroosh(m: {
  ar: boolean;
  subject: string;
  paragraphs: string[];
  button: string;
  alt: string;
  href: string;
  token: string;
}): string {
  const brand = `${siteUrl()}/brand`;
  const dir = m.ar ? 'rtl' : 'ltr';
  const start = m.ar ? 'right' : 'left';
  const font = m.ar
    ? "'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif"
    : "'Titillium Web','Segoe UI',Arial,sans-serif";
  // The first line greets (under the title, in the hero), the last tells them
  // what to do at the gate (the note under the card); the rest is the message.
  const greeting = m.paragraphs[0] ?? '';
  const note = m.paragraphs.length > 2 ? m.paragraphs[m.paragraphs.length - 1] : '';
  const body = m.paragraphs.slice(1, note ? -1 : undefined);
  const navy = '#1E1338';
  const lavender = '#E9E4F2';
  const coins = `${brand}/quroosh-email-coins-purple.png`;
  const table = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';
  return (
    `<!doctype html><html lang="${m.ar ? 'ar' : 'en'}" dir="${dir}">` +
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>` +
    `<body style="margin:0;padding:0;background:${lavender}" bgcolor="${lavender}">` +
    `<table ${table} bgcolor="${lavender}" style="background:${lavender};font-family:${font};direction:${dir}">` +
    // The hero: the logo on the right and the coins on the left in both
    // languages, as on the site (the row does not flip), then the title.
    `<tr><td bgcolor="${navy}" style="background:${navy};padding:28px 24px 8px">` +
    `<table ${table} dir="rtl" style="max-width:520px;margin:0 auto;direction:rtl"><tr>` +
    `<td align="right" valign="top"><img src="${brand}/quroosh-email-logo.png" width="170" alt="قروش" style="display:block;width:170px;height:auto;border:0"></td>` +
    `<td align="left" valign="top"><img src="${coins}" width="120" alt="" style="display:block;width:120px;height:auto;border:0"></td>` +
    `</tr><tr><td colspan="2" dir="${dir}" style="padding:24px 0 0;text-align:${start};direction:${dir}">` +
    `<h1 style="margin:0;font-size:30px;line-height:1.3;font-weight:700;color:#F5F3FA">${escapeHtml(m.subject)}</h1>` +
    `<p style="margin:8px 0 0;font-size:16px;color:#CBC1DB">${escapeHtml(greeting)}</p>` +
    `</td></tr></table></td></tr>` +
    // The wave into the light page.
    `<tr><td style="line-height:0;font-size:0"><img src="${brand}/quroosh-email-wave-top.png" width="600" alt="" style="display:block;width:100%;height:36px;border:0"></td></tr>` +
    // The white card, then the note under it.
    `<tr><td style="padding:12px 16px 0"><table ${table} style="max-width:520px;margin:0 auto"><tr>` +
    `<td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #8E86A6;border-radius:24px;padding:28px 24px;text-align:${start}">` +
    body.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#5B5378">${escapeHtml(p)}</p>`).join('') +
    `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:20px auto"><tr>` +
    `<td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #CBC1DB;border-radius:18px;padding:14px">` +
    `<img src="${escapeHtml(passQrImageUrl(m.token))}" width="220" height="220" alt="${escapeHtml(m.alt)}" style="display:block;border:0"></td></tr></table>` +
    `<table ${table}><tr><td align="center" bgcolor="#542F90" style="background:#542F90;border-radius:16px">` +
    `<a href="${escapeHtml(m.href)}" style="display:block;padding:16px 20px;color:#FFFFFF;font-size:16px;font-weight:700;text-decoration:none">${escapeHtml(m.button)}</a></td></tr></table>` +
    `<p style="margin:14px 0 0;font-size:12px;color:#8E86A6;word-break:break-all;text-align:center" dir="ltr">${escapeHtml(m.href)}</p>` +
    `</td></tr>` +
    (note
      ? `<tr><td style="padding:16px 0 0"><table ${table}><tr>` +
        `<td bgcolor="#F1EEF7" style="background:#F1EEF7;border-radius:16px;padding:14px 16px;font-size:14px;line-height:1.7;color:#5B5378;text-align:${start}">` +
        `<span style="color:#09798B;font-weight:700">&#9432;</span>&nbsp; ${escapeHtml(note)}</td></tr></table></td></tr>`
      : '') +
    `</table></td></tr>` +
    // The navy wave closing it, with the club's line on it.
    `<tr><td style="padding:28px 0 0;line-height:0;font-size:0"><img src="${brand}/quroosh-email-wave-bottom.png" width="600" alt="" style="display:block;width:100%;height:40px;border:0"></td></tr>` +
    `<tr><td bgcolor="${navy}" style="background:${navy};padding:4px 16px 24px;font-size:12px;color:#9B91C0;text-align:center">Vision 2030 Club · نادي رؤية 2030</td></tr>` +
    `</table></body></html>`
  );
}

async function send(row: PassRow, theme: EventTheme): Promise<{ id: string } | { error: string }> {
  const rendered = render(row, theme);
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

  // Whose identity each event wears (Quroosh's, or the club's), asked once
  // per project with the same `event_public` the sign-up page reads. An
  // error only means the plain email.
  const themes = new Map<string, EventTheme>();
  await Promise.all(
    [...new Set(queue.map((row) => row.project_id))].map(async (projectId) => {
      const { data: event } = await db.rpc('event_public', { p_project: projectId });
      themes.set(projectId, ((event as { theme: EventTheme }[] | null)?.[0]?.theme ?? null));
    }),
  );

  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      // Left leased: the next sweep takes it once the lease runs out.
      if (Date.now() - started > budgetMs) {
        report.deferred += 1;
        continue;
      }
      let outcome: { id: string } | { error: string };
      try {
        outcome = await send(row, themes.get(row.project_id) ?? null);
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
