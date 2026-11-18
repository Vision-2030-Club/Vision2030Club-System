import 'server-only';
import { after } from 'next/server';
import { escapeHtml, isEmailConfigured, sendEmail } from '@/lib/email/resend';
import { getAttendeesById, listAttendees, listCheckIns } from '@/lib/eventAttendance/api';
import { newToken } from '@/lib/interviews/tokens';
import { accountLinkUrl, hashToken } from '@/lib/quroosh/accounts';
import { createAdminClient } from '@/lib/supabase/admin';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';

/**
 * Making guest accounts from check-ins, and sending their emails (Quroosh 0006).
 *
 * Event attendance (the club database) knows who was checked in at the gate.
 * Quroosh reads that through its API (src/lib/eventAttendance/api.ts) and
 * keeps its own accounts in the Quroosh database. `syncGuestAccounts` is the
 * one path between them:
 *
 *   1. the check-ins changed since last time  -> who has arrived
 *   2. those attendees, by id                 -> their name and email
 *   3. the attendees changed since last time  -> cancelled passes, corrections
 *   4. `sync_accounts` writes all of it in one transaction: an account and a
 *      "complete your account" email for each new arrival
 *
 * It runs right after a check-in at the gate (`kickGuestAccountSync`) and
 * again on the club's five-minute sweep, which is also what catches up after
 * a failure. A pass can run twice, or two at once: an attendee gets one
 * account and one email whatever happens (`accounts_attendee_once`).
 */

/**
 * How far back of its cursor each pass reads again. A check-in's change time
 * is when its transaction began, so one that began just before the last pass
 * and committed just after it carries a time the cursor has already passed.
 * Reading two minutes back picks those up; reading a row twice does nothing.
 */
const OVERLAP_MS = 2 * 60 * 1000;
const PAGE = 5000;

export type SyncReport = { arrivals: number; created: number; changes: number };

function backFrom(cursor: string | null): string | null {
  return cursor ? new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString() : null;
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
}

/** Whether a project carries both components the accounts need. */
export async function carriesAttendanceAndQuroosh(projectId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('project_components')
    .select('component_key')
    .eq('project_id', projectId)
    .in('component_key', ['quroosh', 'event_attendance']);
  return (data ?? []).length === 2;
}

/** Every project that carries both Quroosh and Event attendance. */
async function projectsToSync(): Promise<string[]> {
  const { data } = await createAdminClient()
    .from('project_components')
    .select('project_id, component_key')
    .in('component_key', ['quroosh', 'event_attendance']);
  const seen = new Map<string, number>();
  for (const row of (data ?? []) as { project_id: string }[]) {
    seen.set(row.project_id, (seen.get(row.project_id) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count === 2).map(([id]) => id);
}

/**
 * One pass for one project. Throws when either database refuses (a migration
 * not applied yet, say); the callers that run unattended catch that.
 */
export async function syncGuestAccounts(projectId: string, pagesLeft = 5): Promise<SyncReport> {
  const quroosh = createQurooshClient();
  const { data: state, error: stateError } = await quroosh.rpc('account_sync_state', { p_project: projectId });
  if (stateError) throw new Error(stateError.message);
  const cursors = (state as { check_ins_cursor: string | null; attendees_cursor: string | null }[] | null)?.[0];

  const [checkIns, changed] = await Promise.all([
    listCheckIns(projectId, backFrom(cursors?.check_ins_cursor ?? null)),
    listAttendees(projectId, backFrom(cursors?.attendees_cursor ?? null)),
  ]);

  // Each attendee's first standing check-in. An undone one made no arrival.
  const firstSeen = new Map<string, string>();
  for (const checkIn of checkIns) {
    if (checkIn.undone_at) continue;
    const known = firstSeen.get(checkIn.attendee_id);
    if (!known || new Date(checkIn.checked_in_at) < new Date(known)) {
      firstSeen.set(checkIn.attendee_id, checkIn.checked_in_at);
    }
  }
  const people = await getAttendeesById(projectId, [...firstSeen.keys()]);
  const arrivals = people
    .filter((person) => !person.cancelled_at)
    .map((person) => ({
      attendee_id: person.id,
      name: person.name,
      phone: person.phone,
      email: person.email,
      locale: person.locale,
      checked_in_at: firstSeen.get(person.id),
    }));
  const changes = changed.map((person) => ({
    attendee_id: person.id,
    name: person.name,
    phone: person.phone,
    email: person.email,
    cancelled: person.cancelled_at !== null,
  }));

  // The lists come oldest change first, so the last row is the furthest read.
  // A full page means there is more: the next pass carries on from there.
  const { data: created, error } = await quroosh.rpc('sync_accounts', {
    p_project: projectId,
    p_arrivals: arrivals,
    p_changes: changes,
    p_check_ins_cursor: later(cursors?.check_ins_cursor ?? null, checkIns.at(-1)?.changed_at ?? null),
    p_attendees_cursor: later(cursors?.attendees_cursor ?? null, changed.at(-1)?.updated_at ?? null),
  });
  if (error) throw new Error(error.message);

  const report = { arrivals: arrivals.length, created: Number(created ?? 0), changes: changes.length };
  // More than a page waiting (the first pass of a long event): read on, a
  // few pages at most; the next sweep takes the rest.
  if (pagesLeft > 1 && (checkIns.length >= PAGE || changed.length >= PAGE)) {
    const next = await syncGuestAccounts(projectId, pagesLeft - 1);
    return {
      arrivals: report.arrivals + next.arrivals,
      created: report.created + next.created,
      changes: report.changes + next.changes,
    };
  }
  return report;
}

// -----------------------------------------------------------------------------
// The emails
// -----------------------------------------------------------------------------

type EmailRow = {
  id: string;
  account_id: string;
  kind: 'complete' | 'signin';
  project_id: string;
  to_email: string;
  to_name: string;
  locale: 'ar' | 'en';
};

/** The two messages, in the guest's language, in the Quroosh colours. */
function render(row: EmailRow, href: string): { subject: string; html: string; text: string } {
  const ar = row.locale !== 'en';
  const complete = row.kind === 'complete';

  const subject = ar
    ? complete
      ? 'أكمل إنشاء حسابك في قروش'
      : 'رابط الدخول إلى حسابك في قروش'
    : complete
      ? 'Complete your Quroosh account'
      : 'Your Quroosh sign-in link';
  const paragraphs = ar
    ? complete
      ? [
          `مرحبًا ${row.to_name}،`,
          'سعدنا بحضورك في قروش. بقيت خطوة واحدة لإنشاء حسابك: اضغط الزر أدناه وأكّد بياناتك.',
          'ستستخدم هذا الحساب لاحقًا في سوق قروش. لا توجد كلمة مرور: ندخلك برابط يصلك على هذا البريد.',
          'الرابط صالح لسبعة أيام، ويُستخدم مرة واحدة.',
        ]
      : [
          `مرحبًا ${row.to_name}،`,
          'اضغط الزر أدناه للدخول إلى حسابك في قروش.',
          'الرابط صالح لخمس عشرة دقيقة، ويُستخدم مرة واحدة. إن لم تطلبه فتجاهل هذه الرسالة.',
        ]
    : complete
      ? [
          `Hello ${row.to_name},`,
          'Thank you for coming to Quroosh. One step is left to create your account: press the button below and confirm your details.',
          'You will use this account later in the Quroosh market. There is no password: we sign you in with a link sent to this address.',
          'The link is good for seven days and works once.',
        ]
      : [
          `Hello ${row.to_name},`,
          'Press the button below to sign in to your Quroosh account.',
          'The link is good for fifteen minutes and works once. If you did not ask for it, ignore this message.',
        ];
  const button = ar ? (complete ? 'إكمال إنشاء الحساب' : 'الدخول إلى حسابي') : complete ? 'Complete my account' : 'Sign in';

  const body = paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.7">${escapeHtml(p)}</p>`).join('');
  const html =
    `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">` +
    `<body style="margin:0;background:#F5F8FA;font-family:'IBM Plex Sans Arabic','Titillium Web',Segoe UI,Arial,sans-serif;color:#1E1338">` +
    `<div style="max-width:560px;margin:0 auto;padding:32px 20px">` +
    `<div style="background:#1E1338;border-radius:12px 12px 0 0;padding:20px 28px;color:#BEE5EC;font-size:22px;font-weight:700">${ar ? 'قروش' : 'Quroosh'}</div>` +
    `<div style="background:#fff;border:1px solid #CBC1DB;border-top:0;border-radius:0 0 12px 12px;padding:28px">` +
    `<h1 style="margin:0 0 16px;font-size:20px;color:#542F90">${escapeHtml(subject)}</h1>${body}` +
    `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#90D4D6;color:#1E1338;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">${escapeHtml(button)}</a></p>` +
    `<p style="margin:0;font-size:12px;color:#3E3661;word-break:break-all">${escapeHtml(href)}</p>` +
    `</div><p style="margin:16px 0 0;font-size:12px;color:#3E3661;text-align:center">Vision 2030 Club · نادي رؤية 2030</p></div></body></html>`;
  const text = [subject, '', ...paragraphs, '', `${button}: ${href}`].join('\n');
  return { subject, html, text };
}

export type AccountEmailReport = { claimed: number; sent: number; failed: number; deferred: number };

/**
 * Sends the queued account emails. Safe to call from anywhere: with nothing
 * queued it does nothing, without the Resend variables it leaves every row
 * where it is, and before 0006 is applied it returns quietly.
 *
 * The link in each email is made here, at the moment of sending: the queue
 * holds no token, so an email that is never sent leaves no link behind.
 */
export async function deliverAccountEmails(limit = 50, budgetMs = 30_000): Promise<AccountEmailReport> {
  const started = Date.now();
  const report: AccountEmailReport = { claimed: 0, sent: 0, failed: 0, deferred: 0 };
  if (!isEmailConfigured() || !isQurooshConfigured()) return report;

  const db = createQurooshClient();
  const { data, error } = await db.rpc('claim_account_emails', { p_limit: limit });
  if (error) return report;
  const queue = (data ?? []) as EmailRow[];
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
        const token = newToken();
        const { error: tokenError } = await db.rpc('issue_account_token', {
          p_account: row.account_id,
          p_kind: row.kind,
          p_token_hash: hashToken(token),
        });
        outcome = tokenError
          ? { error: tokenError.message }
          : await sendEmail({
              to: row.to_email,
              toName: row.to_name,
              ...render(row, accountLinkUrl(row.locale === 'en' ? 'en' : 'ar', token)),
            });
      } catch (caught) {
        outcome = { error: caught instanceof Error ? caught.message : 'Unknown error' };
      }
      if ('id' in outcome) report.sent += 1;
      else report.failed += 1;
      await db.rpc('account_email_result', {
        p_id: row.id,
        p_provider_id: 'id' in outcome ? outcome.id : null,
        p_error: 'error' in outcome ? outcome.error : null,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return report;
}

/** For the end of a server action: send once the response is out the door. */
export function kickAccountEmails(): void {
  after(async () => {
    try {
      await deliverAccountEmails();
    } catch (error) {
      console.error('[quroosh/accounts] email delivery failed', error);
    }
  });
}

/**
 * After a check-in at the gate: make the arrival's account and send their
 * email, once the scanner has its answer. Does nothing for a project that
 * does not carry Quroosh, and never fails the check-in.
 */
export function kickGuestAccountSync(projectId: string): void {
  if (!isQurooshConfigured()) return;
  after(async () => {
    try {
      if (!(await carriesAttendanceAndQuroosh(projectId))) return;
      const { created } = await syncGuestAccounts(projectId);
      if (created > 0) await deliverAccountEmails();
    } catch (error) {
      console.error('[quroosh/accounts] sync after a check-in failed', error);
    }
  });
}

/** The sweep: every project that carries both components, then the emails. */
export async function sweepGuestAccounts(): Promise<{ projects: number; created: number; emails: AccountEmailReport } | null> {
  if (!isQurooshConfigured()) return null;
  let created = 0;
  const projects = await projectsToSync();
  for (const projectId of projects) {
    try {
      created += (await syncGuestAccounts(projectId)).created;
    } catch (error) {
      // One project's trouble (a migration not applied) must not stop the rest.
      console.error('[quroosh/accounts] sweep failed for a project', error);
    }
  }
  return { projects: projects.length, created, emails: await deliverAccountEmails(100, 15_000) };
}
