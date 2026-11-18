import 'server-only';

/**
 * One email through Resend, with a plain HTTP call: no SDK, one endpoint.
 *
 * The interviews' emails (src/lib/interviews/email.ts) and the event passes
 * (src/lib/eventAttendance/email.ts) each carry their own copy of this call;
 * new code should use this one.
 *
 * Needs RESEND_API_KEY and EMAIL_FROM (a sender on a domain verified in
 * Resend). Callers check `isEmailConfigured()` first and leave their rows
 * queued when it is false.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type OutgoingEmail = {
  to: string;
  /** Shown beside the address. Characters that would break it are dropped. */
  toName?: string | null;
  subject: string;
  html: string;
  text: string;
};

/** Sends one message. Answers Resend's id for it, or why it was not sent. */
export async function sendEmail(email: OutgoingEmail): Promise<{ id: string } | { error: string }> {
  const name = (email.toName ?? '').replace(/[<>",;]/g, ' ').trim();
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [name ? `${name} <${email.to}>` : email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!response.ok || !body.id) {
    return { error: `${response.status} ${body.message ?? body.name ?? 'Resend refused the message'}` };
  }
  return { id: body.id };
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
