import { escapeHtml } from '@/lib/email/resend';
import { siteUrl } from '@/lib/site';

/**
 * The Quroosh emails' layout, in the identity's page design (QurooshPage on
 * the site): a navy hero with the logo ("Powered by RAYH") on the right and a
 * pair of the identity's purple coins on the left in both languages, the
 * title and the greeting under them; a wave into a light lavender body; a
 * white card with the message, an optional middle block (the pass's QR) and
 * the purple button; a quiet note under the card; a navy wave closing it.
 *
 * Used by the event pass of an event that carries Quroosh
 * (src/lib/eventAttendance/email.ts) and by the guest account's emails
 * (src/lib/quroosh/accountSync.ts). Built from tables with inline styles and
 * bgcolor, the form mail apps keep; the pictures are PNGs on the site
 * (public/brand/quroosh-email-*), since mail apps drop SVG and CSS rotation,
 * so they show once the site that sends them is deployed.
 */
export function qurooshEmailHtml(m: {
  ar: boolean;
  title: string;
  greeting: string;
  /** The message's paragraphs, in the card. */
  body: string[];
  /** Ready HTML placed in the card after the message, before the button. */
  middle?: string;
  button: string;
  href: string;
  /** A line of help under the card. */
  note?: string;
}): string {
  const brand = `${siteUrl()}/brand`;
  const dir = m.ar ? 'rtl' : 'ltr';
  const start = m.ar ? 'right' : 'left';
  const font = m.ar ? "'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif" : "'Titillium Web','Segoe UI',Arial,sans-serif";
  const navy = '#1E1338';
  const lavender = '#E9E4F2';
  // Mail apps in dark mode (Gmail above all) flip background colours but not
  // background images, so the navy is also painted as a one-colour gradient:
  // the hero and the footer stay navy, behind the logo and coins drawn on it.
  const keepNavy = `background:${navy};background-image:linear-gradient(${navy},${navy})`;
  const table = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';
  return (
    `<!doctype html><html lang="${m.ar ? 'ar' : 'en'}" dir="${dir}">` +
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>u + .body .q-screen{background:#000;mix-blend-mode:screen}u + .body .q-diff{background:#000;mix-blend-mode:difference}</style>` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>` +
    `<body class="body" style="margin:0;padding:0;background:${lavender}" bgcolor="${lavender}">` +
    `<table ${table} bgcolor="${lavender}" style="background:${lavender};font-family:${font};direction:${dir}">` +
    // The hero: the logo on the right and the coins on the left in both
    // languages, as on the site (the row does not flip), then the title.
    `<tr><td bgcolor="${navy}" style="${keepNavy};padding:28px 24px 8px">` +
    `<table ${table} dir="rtl" style="max-width:520px;margin:0 auto;direction:rtl"><tr>` +
    `<td align="right" valign="top"><img src="${brand}/quroosh-email-logo.png" width="170" alt="قروش" style="display:block;width:170px;height:auto;border:0"></td>` +
    `<td align="left" valign="top"><img src="${brand}/quroosh-email-coins-purple.png" width="120" alt="" style="display:block;width:120px;height:auto;border:0"></td>` +
    `</tr><tr><td colspan="2" dir="${dir}" style="padding:24px 0 0;text-align:${start};direction:${dir}">` +
    `<div class="q-screen"><div class="q-diff">` +
    `<h1 style="margin:0;font-size:30px;line-height:1.3;font-weight:700;color:#F5F3FA">${escapeHtml(m.title)}</h1>` +
    `<p style="margin:8px 0 0;font-size:16px;color:#CBC1DB">${escapeHtml(m.greeting)}</p>` +
    `</div></div>` +
    `</td></tr></table></td></tr>` +
    // The wave into the light page.
    `<tr><td style="line-height:0;font-size:0"><img src="${brand}/quroosh-email-wave-top.png" width="600" alt="" style="display:block;width:100%;height:36px;border:0"></td></tr>` +
    // The white card, then the note under it.
    `<tr><td style="padding:12px 16px 0"><table ${table} style="max-width:520px;margin:0 auto"><tr>` +
    `<td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #8E86A6;border-radius:24px;padding:28px 24px;text-align:${start}">` +
    m.body.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#5B5378">${escapeHtml(p)}</p>`).join('') +
    (m.middle ?? '<div style="height:12px;line-height:12px;font-size:0">&nbsp;</div>') +
    `<table ${table}><tr><td align="center" bgcolor="#542F90" style="background:#542F90;border-radius:16px">` +
    `<a href="${escapeHtml(m.href)}" style="display:block;padding:16px 20px;color:#FFFFFF;font-size:16px;font-weight:700;text-decoration:none">${escapeHtml(m.button)}</a></td></tr></table>` +
    `<p style="margin:14px 0 0;font-size:12px;color:#8E86A6;word-break:break-all;text-align:center" dir="ltr">${escapeHtml(m.href)}</p>` +
    `</td></tr>` +
    (m.note
      ? `<tr><td style="padding:16px 0 0"><table ${table}><tr>` +
        `<td bgcolor="#F1EEF7" style="background:#F1EEF7;border-radius:16px;padding:14px 16px;font-size:14px;line-height:1.7;color:#5B5378;text-align:${start}">` +
        `<span style="color:#09798B;font-weight:700">&#9432;</span>&nbsp; ${escapeHtml(m.note)}</td></tr></table></td></tr>`
      : '') +
    `</table></td></tr>` +
    // The navy wave closing it, with the club's line on it.
    `<tr><td style="padding:28px 0 0;line-height:0;font-size:0"><img src="${brand}/quroosh-email-wave-bottom.png" width="600" alt="" style="display:block;width:100%;height:40px;border:0"></td></tr>` +
    `<tr><td bgcolor="${navy}" style="${keepNavy};padding:4px 16px 24px;font-size:12px;color:#9B91C0;text-align:center">` +
    `<div class="q-screen"><div class="q-diff">Vision 2030 Club · نادي رؤية 2030</div></div></td></tr>` +
    `</table></body></html>`
  );
}
