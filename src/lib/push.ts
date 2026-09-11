import 'server-only';
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
};

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
      { TTL: 60 * 60 * 24, urgency: 'high' },
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

/**
 * Sends one payload to every device a member has. Used by the test button
 * and by the outbox drain alike, so both paths clean up dead subscriptions.
 */
async function sendToMember(
  memberId: string,
  render: (locale: 'ar' | 'en') => PushPayload,
): Promise<{ delivered: number; dropped: number; errors: string[]; devices: number }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, locale')
    .eq('member_id', memberId);

  const subs = (data ?? []) as SubscriptionRow[];
  let delivered = 0;
  let dropped = 0;
  const errors: string[] = [];

  for (const sub of subs) {
    const outcome = await sendToSubscription(sub, render(sub.locale));
    if (outcome === 'sent') {
      delivered += 1;
    } else if (outcome === 'gone') {
      await admin.from('push_subscriptions').delete().eq('id', sub.id);
      dropped += 1;
    } else {
      errors.push(outcome.error);
    }
  }

  return { delivered, dropped, errors, devices: subs.length };
}

/**
 * Drains the outbox. Safe to call from anywhere at any time: with nothing
 * queued it does nothing, and without VAPID keys it leaves the rows for a
 * deployment that has them.
 */
export async function deliverPendingNotifications(limit = 50): Promise<DeliveryReport> {
  const report: DeliveryReport = { claimed: 0, delivered: 0, dropped: 0, failed: 0 };
  if (!isPushConfigured()) return report;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('push_claim_outbox', { p_limit: limit });
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as OutboxRow[]) {
    report.claimed += 1;

    const result = await sendToMember(row.member_id, (locale) => payloadFor(row, locale));
    report.delivered += result.delivered;
    report.dropped += result.dropped;

    // "Failed" means every device refused. Zero devices is not a failure —
    // the person turned notifications off between the trigger and now.
    const failed = result.devices > 0 && result.delivered === 0 && result.errors.length > 0;
    if (failed) report.failed += 1;

    await admin
      .from('notification_outbox')
      .update({
        sent_at: failed ? null : new Date().toISOString(),
        delivered: result.delivered,
        last_error: result.errors[0] ?? null,
        claimed_at: null,
      })
      .eq('id', row.id);
  }

  return report;
}

/**
 * Fire-and-forget delivery for the end of a server action. Not awaited for
 * the same reason `ensureMeetLink` is not: the write has committed, and the
 * page should not wait on Apple to update.
 */
export function kickPushDelivery(): void {
  void deliverPendingNotifications().catch((error) => {
    console.error('[push] delivery failed', error);
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

  const result = await sendToMember(memberId, (locale) => ({
    title: locale === 'ar' ? 'الإشعارات تعمل' : 'Notifications are working',
    body:
      locale === 'ar'
        ? 'ستصلك تنبيهات الطلبات والمهام والاجتماعات هنا.'
        : 'Requests, tasks and meetings will reach you here.',
    url: `/${locale}/dashboard`,
    tag: 'test',
  }));

  return {
    delivered: result.delivered,
    devices: result.devices - result.dropped,
    error: result.errors[0],
  };
}

/** Removes rows nobody will look at again. Called by the scheduled job. */
export async function pruneOutbox(olderThanDays = 7): Promise<void> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  await admin.from('notification_outbox').delete().lt('sent_at', cutoff);
}
