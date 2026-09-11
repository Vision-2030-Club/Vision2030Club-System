'use server';

import { getMyMember } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { sendTestNotification } from '@/lib/push';
import { routing } from '@/i18n/routing';
import { fail, ok, type ActionResult } from '@/lib/actions';

/**
 * A device turning notifications on and off.
 *
 * These write through the user-scoped client on purpose: `push_subscriptions`
 * has policies that tie every row to `app.current_member_id()`, so a
 * subscription can only ever be saved under, or removed from, the person who
 * is signed in on that device. The server does not have to check.
 */

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale: string;
  userAgent?: string;
};

function localeOf(value: string): 'ar' | 'en' {
  return (routing.locales as readonly string[]).includes(value)
    ? (value as 'ar' | 'en')
    : routing.defaultLocale;
}

export async function savePushSubscriptionAction(
  input: PushSubscriptionInput,
): Promise<ActionResult> {
  const me = await getMyMember();
  if (!me) return fail('Not signed in.');

  if (!input?.endpoint || !input.keys?.p256dh || !input.keys?.auth) {
    return fail('The browser did not return a usable subscription.');
  }

  const supabase = await createClient();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      member_id: me.id,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      locale: localeOf(input.locale),
      user_agent: input.userAgent?.slice(0, 300) ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );

  if (error) return fail(error.message);
  return ok();
}

export async function removePushSubscriptionAction(endpoint: string): Promise<ActionResult> {
  if (!endpoint) return fail('Missing endpoint.');
  const supabase = await createClient();
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) return fail(error.message);
  return ok();
}

/**
 * Called on every app open by a device that is subscribed. Keeps the row's
 * language current — so switching the app to English switches the
 * notifications too — and records that the device is still alive.
 */
export async function touchPushSubscriptionAction(
  endpoint: string,
  locale: string,
): Promise<void> {
  if (!endpoint) return;
  const supabase = await createClient();
  await supabase
    .from('push_subscriptions')
    .update({ locale: localeOf(locale), last_seen_at: new Date().toISOString() })
    .eq('endpoint', endpoint);
}

export type TestPushResult = { ok: boolean; delivered: number; devices: number; error?: string };

export async function sendTestPushAction(): Promise<TestPushResult> {
  const me = await getMyMember();
  if (!me) return { ok: false, delivered: 0, devices: 0, error: 'Not signed in.' };

  const result = await sendTestNotification(me.id);
  return { ok: !result.error, ...result };
}
