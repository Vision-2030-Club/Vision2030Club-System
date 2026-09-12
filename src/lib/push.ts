import 'server-only';
import { after } from 'next/server';
import webpush, { WebPushError } from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Sending what the database queued.
 *
 * Triggers in 0049 decide WHO a change concerns and write a row per person to
 * `notification_outbox`. This file turns those rows into Web Push messages —
 * one per device the person turned notifications on from — and forgets them.
 *
 * Everything here uses the service-role client: the outbox has no policies,
 * and a subscription is only ever read by the server that delivers to it.
 *
 * Two entry points call `deliverPendingNotifications`:
 *   - the action that caused the change (`kickPushDelivery`), so a request
 *     approved at 14:00 reaches a phone at 14:00, not at the next sweep
 *   - the scheduled job (/api/push/cron), which also queues reminders and
 *     retries anything the first attempt could not send
 * They can overlap; `push_claim_outbox` leases rows so they never both send
 * the same one.
 *
 * The database is a continent away from the function (HANDOFF: Sydney vs
 * Mumbai), so every round trip is ~1s. A pass therefore makes as few as it
 * can — one claim, one read of every device involved, then the sends in
 * parallel — and stops starting new sends once its time budget is spent,
 * leaving the rest leased for the next pass rather than being cut off
 * mid-flight by the platform.
 */

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
};

type OutboxRow = {
  id: string;
  member_id: string;
  kind: string;
  title_en: string;
  title_ar: string;
  body_en: string;
  body_ar: string;
  url: string;
  dedupe_key: string | null;
};

type SubscriptionRow = {
  id: string;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: 'ar' | 'en';
};

export type DeliveryReport = {
  /** Outbox rows taken in this pass. */
  claimed: number;
  /** Devices that accepted a message. */
  delivered: number;
  /** Subscriptions the push service said were gone, now deleted. */
  dropped: number;
  /** Rows every device refused; they stay queued for a retry. */
  failed: number;
  /** Rows claimed but not attempted because the time budget ran out. */
  deferred: number;
  /** Wall time of the pass, in milliseconds. */
  ms: number;
};

/** How many rows are sent at once. Apple's service copes with far more. */
const CONCURRENCY = 6;

export function isPushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let vapidReady = false;

function client() {
  if (!vapidReady) {
    webpush.setVapidDetails(
      // A contact for the push service, should it need one. A URL is valid
      // here; the deployment's own origin is the honest default.
      process.env.VAPID_SUBJECT ?? 'https://vision2030club-system.vercel.app',
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    vapidReady = true;
  }
  return webpush;
}

function payloadFor(row: OutboxRow, locale: 'ar' | 'en'): PushPayload {
  return {
    title: locale === 'ar' ? row.title_ar : row.title_en,
    body: locale === 'ar' ? row.body_ar : row.body_en,
    // The URL in the row has no locale; the device's language supplies it.
    url: `/${locale}${row.url.startsWith('/') ? row.url : `/${row.url}`}`,
    tag: row.dedupe_key ?? undefined,
  };
}

type SendOutcome = 'sent' | 'gone' | { error: string };

async function sendToSubscription(
  sub: SubscriptionRow,
  payload: PushPayload,
): Promise<SendOutcome> {
  try {
    await client().sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      // A day: a phone that is off overnight still gets "your request was
      // approved" in the morning; anything older than that is stale.
      { TTL: 60 * 60 * 24, urgency: 'high', timeout: 10_000 },
    );
    return 'sent';
  } catch (error) {
    // 404/410 is the push service saying this device unsubscribed — on iOS,
    // that is what removing the app from the Home Screen looks like.
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
      return 'gone';
    }
    return { error: error instanceof Error ? error.message : 'Unknown push error' };
  }
}

/** Sends one payload to each of a member's devices, in parallel. */
async function sendToDevices(
  subs: SubscriptionRow[],
  render: (locale: 'ar' | 'en') => PushPayload,
): Promise<{ delivered: number; gone: string[]; errors: string[] }> {
  const outcomes = await Promise.all(subs.map((sub) => sendToSubscription(sub, render(sub.locale))));
  const gone: string[] = [];
  const errors: string[] = [];
  let delivered = 0;
  outcomes.forEach((outcome, i) => {
    if (outcome === 'sent') delivered += 1;
    else if (outcome === 'gone') gone.push(subs[i].id);
    else errors.push(outcome.error);
  });
  return { delivered, gone, errors };
}

async function subscriptionsOf(memberIds: string[]): Promise<Map<string, SubscriptionRow[]>> {
  const byMember = new Map<string, SubscriptionRow[]>();
  if (memberIds.length === 0) return byMember;
  const admin = createAdminClient();
  const { data } = await admin
    .from('push_subscriptions')
    .select('id, member_id, endpoint, p256dh, auth, locale')
    .in('member_id', [...new Set(memberIds)]);
  for (const sub of (data ?? []) as SubscriptionRow[]) {
    const list = byMember.get(sub.member_id) ?? [];
    list.push(sub);
    byMember.set(sub.member_id, list);
  }
  return byMember;
}

/**
 * Drains the outbox. Safe to call from anywhere at any time: with nothing
 * queued it does nothing, and without VAPID keys it leaves the rows for a
 * deployment that has them.
 *
 * `budgetMs` bounds the pass. Rows not reached stay leased and are picked up
 * by the next pass once the lease lapses (two minutes).
 */
export async function deliverPendingNotifications(
  limit = 50,
  budgetMs = 40_000,
): Promise<DeliveryReport> {
  const started = Date.now();
  const report: DeliveryReport = { claimed: 0, delivered: 0, dropped: 0, failed: 0, deferred: 0, ms: 0 };
  if (!isPushConfigured()) return report;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('push_claim_outbox', { p_limit: limit });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as OutboxRow[];
  report.claimed = rows.length;
  if (rows.length === 0) {
    report.ms = Date.now() - started;
    return report;
  }

  const devices = await subscriptionsOf(rows.map((r) => r.member_id));
  const gone = new Set<string>();
  // Supabase builders are thenables, not Promises; Promise.all takes either.
  const updates: PromiseLike<unknown>[] = [];

  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      if (Date.now() - started > budgetMs) {
        report.deferred += 1;
        continue;
      }

      const subs = devices.get(row.member_id) ?? [];
      const result = await sendToDevices(subs, (locale) => payloadFor(row!, locale));
      result.gone.forEach((id) => gone.add(id));
      report.delivered += result.delivered;

      // "Failed" means every device refused. Zero devices is not a failure —
      // the person turned notifications off between the trigger and now.
      const failed = subs.length > 0 && result.delivered === 0 && result.errors.length > 0;
      if (failed) report.failed += 1;

      updates.push(
        admin
          .from('notification_outbox')
          .update({
            sent_at: failed ? null : new Date().toISOString(),
            delivered: result.delivered,
            last_error: result.errors[0] ?? null,
            claimed_at: null,
          })
          .eq('id', row.id),
      );
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

  if (gone.size > 0) {
    updates.push(admin.from('push_subscriptions').delete().in('id', [...gone]));
    report.dropped = gone.size;
  }
  await Promise.all(updates);

  report.ms = Date.now() - started;
  return report;
}

/**
 * Delivery for the end of a server action. Runs once the response has been
 * sent (`after`), so the page updates immediately and the platform keeps the
 * function alive for the sends — a bare `void promise` after the return is
 * not guaranteed to finish on a serverless host.
 */
export function kickPushDelivery(): void {
  after(async () => {
    try {
      await deliverPendingNotifications();
    } catch (error) {
      console.error('[push] delivery failed', error);
    }
  });
}

/** The "Send a test" button. Bypasses the outbox so the result is immediate. */
export async function sendTestNotification(
  memberId: string,
): Promise<{ delivered: number; devices: number; error?: string }> {
  if (!isPushConfigured()) {
    return {
      delivered: 0,
      devices: 0,
      error: 'Push is not set up on this server (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).',
    };
  }

  const subs = (await subscriptionsOf([memberId])).get(memberId) ?? [];
  const result = await sendToDevices(subs, (locale) => ({
    title: locale === 'ar' ? 'الإشعارات تعمل' : 'Notifications are working',
    body:
      locale === 'ar'
        ? 'ستصلك تنبيهات الطلبات والمهام والاجتماعات هنا.'
        : 'Requests, tasks and meetings will reach you here.',
    url: `/${locale}/dashboard`,
    tag: 'test',
  }));

  if (result.gone.length > 0) {
    await createAdminClient().from('push_subscriptions').delete().in('id', result.gone);
  }

  return {
    delivered: result.delivered,
    devices: subs.length - result.gone.length,
    error: result.errors[0],
  };
}

/** Removes rows nobody will look at again. Called by the scheduled job. */
export async function pruneOutbox(olderThanDays = 7): Promise<void> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  await admin.from('notification_outbox').delete().lt('sent_at', cutoff);
}
