import 'server-only';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import type { EditionSettings, Feedback, OutboxRow } from '@/lib/interviews/types';

/**
 * Sending what the interviews database queued.
 *
 * The functions in the database write a row to `email_outbox` saying what
 * happened to whom (an acceptance, a booking, a reminder, feedback). This
 * file turns each row into a message in the student's own language and sends
 * it through Resend with a plain HTTP call — no SDK, one endpoint.
 *
 * Two entry points, exactly like the club's push delivery (src/lib/push.ts):
 * the action that caused the row kicks a pass after its response is sent, and
 * the scheduled sweep (/api/interviews/cron) retries whatever remains.
 * `claim_email_outbox` leases rows, so the two never send the same one.
 *
 * Without RESEND_API_KEY nothing is sent and nothing is lost: the rows wait,
 * and the Messages page says the key is missing.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const CONCURRENCY = 4;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Where the links in an email point. The deployment, unless told otherwise. */
export function siteUrl(): string {
  return (process.env.SITE_URL ?? 'https://vision2030-club-system.vercel.app').replace(/\/$/, '');
}

export type EmailReport = {
  claimed: number;
  sent: number;
  failed: number;
  deferred: number;
  ms: number;
};

type Rendered = { subject: string; html: string; text: string };

// -----------------------------------------------------------------------------
// Formatting
// -----------------------------------------------------------------------------

function intlLocale(locale: 'ar' | 'en') {
  return locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB';
}

function whenLabel(iso: string, locale: 'ar' | 'en', timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function timeLabel(iso: string, locale: 'ar' | 'en', timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One layout for every message: a heading, paragraphs, an optional button. */
function wrap(locale: 'ar' | 'en', title: string, paragraphs: string[], button?: { label: string; href: string }): Rendered {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.6">${escapeHtml(p)}</p>`).join('');
  const cta = button
    ? `<p style="margin:20px 0"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#007a8f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(button.label)}</a></p><p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">${escapeHtml(button.href)}</p>`
    : '';
  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#f6f8f9;font-family:'IBM Plex Sans Arabic',Segoe UI,Arial,sans-serif;color:#0f172a"><div style="max-width:560px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px"><h1 style="margin:0 0 16px;font-size:20px;color:#076174">${escapeHtml(title)}</h1>${body}${cta}</div><p style="margin:16px 0 0;font-size:12px;color:#64748b;text-align:center">Vision 2030 Club · نادي رؤية 2030</p></div></body></html>`;
  const text = [title, '', ...paragraphs, button ? `\n${button.label}: ${button.href}` : ''].join('\n');
  return { subject: title, html, text };
}

// -----------------------------------------------------------------------------
// Templates, by kind
// -----------------------------------------------------------------------------

type Ctx = { db: SupabaseClient; row: OutboxRow; locale: 'ar' | 'en' };

async function renderAccepted({ db, row, locale }: Ctx): Promise<Rendered | null> {
  if (!row.application_id) return null;
  const [{ data: application }, { data: prefs }] = await Promise.all([
    db.from('applications').select('name, personal_token').eq('id', row.application_id).maybeSingle(),
    db
      .from('application_preferences')
      .select('decision, companies(name_en, name_ar)')
      .eq('application_id', row.application_id)
      .eq('decision', 'accepted'),
  ]);
  if (!application) return null;
  const companies = (prefs ?? [])
    .map((p) => p.companies as unknown as { name_en: string; name_ar: string } | null)
    .filter(Boolean)
    .map((c) => (locale === 'ar' ? c!.name_ar : c!.name_en));
  const href = `${siteUrl()}/${locale}/interviews/s/${application.personal_token}`;

  return locale === 'ar'
    ? wrap('ar', 'تم قبولك في المقابلات التجريبية', [
        `مرحبًا ${application.name}،`,
        `تم قبولك لمقابلة: ${companies.join('، ')}.`,
        'اختر موعدًا لكل شركة من رابطك الشخصي. الرابط خاص بك، فلا تشاركه مع أحد.',
      ], { label: 'اختيار المواعيد', href })
    : wrap('en', 'You are in: mock interviews', [
        `Hello ${application.name},`,
        `You have been accepted to meet: ${companies.join(', ')}.`,
        'Pick a time with each company from your personal link. It is yours alone — please do not share it.',
      ], { label: 'Choose your times', href });
}

function bookingLines(payload: Record<string, unknown>, locale: 'ar' | 'en'): { company: string; when: string; room: string } {
  const zone = String(payload.time_zone ?? 'Asia/Riyadh');
  return {
    company: String(locale === 'ar' ? payload.company_name_ar : payload.company_name_en),
    when: `${whenLabel(String(payload.starts_at), locale, zone)} – ${timeLabel(String(payload.ends_at), locale, zone)}`,
    room: String(payload.room ?? ''),
  };
}

async function renderBooking({ db, row, locale }: Ctx, kind: 'booking_confirmed' | 'booking_moved' | 'booking_cancelled' | 'reminder'): Promise<Rendered | null> {
  const lines = bookingLines(row.payload, locale);
  let href: string | undefined;
  if (row.application_id) {
    const { data } = await db.from('applications').select('personal_token').eq('id', row.application_id).maybeSingle();
    if (data?.personal_token) href = `${siteUrl()}/${locale}/interviews/s/${data.personal_token}`;
  }
  const manage = href ? { label: locale === 'ar' ? 'مواعيدي' : 'My interviews', href } : undefined;

  if (kind === 'booking_confirmed') {
    return locale === 'ar'
      ? wrap('ar', `تأكيد موعدك مع ${lines.company}`, [`الموعد: ${lines.when}`, `القاعة: ${lines.room}`, 'احضر قبل موعدك بعشر دقائق وسجّل وصولك عند الاستقبال.'], manage)
      : wrap('en', `Your interview with ${lines.company} is booked`, [`When: ${lines.when}`, `Room: ${lines.room}`, 'Please arrive ten minutes early and check in at reception.'], manage);
  }
  if (kind === 'booking_moved') {
    const prev = row.payload.previous as Record<string, unknown> | undefined;
    const before = prev ? bookingLines(prev, locale) : null;
    return locale === 'ar'
      ? wrap('ar', `تغيّر موعدك مع ${lines.company}`, [`الموعد الجديد: ${lines.when}`, `القاعة: ${lines.room}`, before ? `الموعد السابق: ${before.when} (${before.room})` : ''].filter(Boolean), manage)
      : wrap('en', `Your interview with ${lines.company} has moved`, [`New time: ${lines.when}`, `Room: ${lines.room}`, before ? `Previously: ${before.when} (${before.room})` : ''].filter(Boolean), manage);
  }
  if (kind === 'booking_cancelled') {
    const reason = row.payload.reason ? String(row.payload.reason) : '';
    return locale === 'ar'
      ? wrap('ar', `أُلغي موعدك مع ${lines.company}`, [`الموعد الملغى: ${lines.when}`, reason ? `السبب: ${reason}` : '', 'يمكنك اختيار موعد آخر من رابطك ما دام الحجز مفتوحًا.'].filter(Boolean), manage)
      : wrap('en', `Your interview with ${lines.company} was cancelled`, [`Cancelled: ${lines.when}`, reason ? `Reason: ${reason}` : '', 'You can pick another time from your link while booking is open.'].filter(Boolean), manage);
  }
  return locale === 'ar'
    ? wrap('ar', `تذكير: مقابلتك مع ${lines.company} غدًا`, [`الموعد: ${lines.when}`, `القاعة: ${lines.room}`, 'احضر قبل موعدك بعشر دقائق وسجّل وصولك عند الاستقبال.'], manage)
    : wrap('en', `Reminder: ${lines.company} tomorrow`, [`When: ${lines.when}`, `Room: ${lines.room}`, 'Please arrive ten minutes early and check in at reception.'], manage);
}

async function renderFeedback({ db, row, locale }: Ctx): Promise<Rendered | null> {
  const feedbackId = String(row.payload.feedback_id ?? '');
  if (!feedbackId) return null;
  const [{ data: feedback }, { data: settings }] = await Promise.all([
    db.from('feedback').select('*, companies(name_en, name_ar)').eq('id', feedbackId).maybeSingle(),
    db.rpc('edition_settings', { p_edition: row.edition_id }),
  ]);
  if (!feedback) return null;
  const f = feedback as unknown as Feedback & { companies: { name_en: string; name_ar: string } | null };
  const labels = ((settings as EditionSettings | null)?.rating_labels ?? []);
  const company = locale === 'ar' ? f.companies?.name_ar : f.companies?.name_en;

  const ratingLines = labels
    .filter((label) => typeof f.ratings[label.key] === 'number')
    .map((label) => `${locale === 'ar' ? label.ar : label.en}: ${f.ratings[label.key]}/5`);

  const paragraphs = locale === 'ar'
    ? [
        `هذه ملاحظات المُقابِل من ${company ?? ''} على مقابلتك التجريبية.`,
        ...ratingLines,
        f.strengths ? `نقاط القوة: ${f.strengths}` : '',
        f.improvements ? `ما يمكن تحسينه: ${f.improvements}` : '',
        f.overall ? `ملاحظة عامة: ${f.overall}` : '',
        'شكرًا لمشاركتك، ونتمنى لك التوفيق.',
      ]
    : [
        `Here is the interviewer's feedback from ${company ?? ''} on your mock interview.`,
        ...ratingLines,
        f.strengths ? `Strengths: ${f.strengths}` : '',
        f.improvements ? `To improve: ${f.improvements}` : '',
        f.overall ? `Overall: ${f.overall}` : '',
        'Thank you for taking part, and good luck.',
      ];

  return wrap(locale, locale === 'ar' ? `ملاحظات مقابلتك مع ${company ?? ''}` : `Feedback from ${company ?? ''}`, paragraphs.filter(Boolean));
}

export async function renderEmail(db: SupabaseClient, row: OutboxRow): Promise<Rendered | null> {
  const ctx: Ctx = { db, row, locale: row.locale === 'en' ? 'en' : 'ar' };
  switch (row.kind) {
    case 'accepted':
      return renderAccepted(ctx);
    case 'booking_confirmed':
    case 'booking_moved':
    case 'booking_cancelled':
    case 'reminder':
      return renderBooking(ctx, row.kind);
    case 'feedback':
      return renderFeedback(ctx);
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Sending
// -----------------------------------------------------------------------------

async function sendViaResend(to: string, toName: string | null, rendered: Rendered): Promise<{ id: string } | { error: string }> {
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [toName ? `${toName.replace(/[<>]/g, '')} <${to}>` : to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
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
 * Drains the outbox. Safe to call from anywhere: with nothing queued it does
 * nothing, and without a key it leaves every row where it is.
 */
export async function deliverPendingEmails(limit = 50, budgetMs = 40_000): Promise<EmailReport> {
  const started = Date.now();
  const report: EmailReport = { claimed: 0, sent: 0, failed: 0, deferred: 0, ms: 0 };
  if (!isEmailConfigured()) return report;

  const db = createInterviewsClient();
  const { data, error } = await db.rpc('claim_email_outbox', { p_limit: limit });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as OutboxRow[];
  report.claimed = rows.length;

  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      if (Date.now() - started > budgetMs) {
        report.deferred += 1;
        continue;
      }

      let outcome: { id: string } | { error: string };
      try {
        const rendered = await renderEmail(db, row);
        outcome = rendered
          ? await sendViaResend(row.to_email, row.to_name, rendered)
          : { error: `Nothing to render for kind "${row.kind}"` };
      } catch (caught) {
        outcome = { error: caught instanceof Error ? caught.message : 'Unknown error' };
      }

      if ('id' in outcome) {
        report.sent += 1;
        await db
          .from('email_outbox')
          .update({ sent_at: new Date().toISOString(), provider_id: outcome.id, last_error: null, claimed_at: null })
          .eq('id', row.id);
        if (row.kind === 'feedback' && row.payload.feedback_id) {
          await db
            .from('feedback')
            .update({ email_sent_at: new Date().toISOString() })
            .eq('id', String(row.payload.feedback_id));
        }
      } else {
        report.failed += 1;
        await db
          .from('email_outbox')
          .update({ last_error: outcome.error.slice(0, 500), claimed_at: null })
          .eq('id', row.id);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  report.ms = Date.now() - started;
  return report;
}

/** For the end of a server action: send once the response is out the door. */
export function kickEmailDelivery(): void {
  after(async () => {
    try {
      await deliverPendingEmails();
    } catch (error) {
      console.error('[interviews/email] delivery failed', error);
    }
  });
}
