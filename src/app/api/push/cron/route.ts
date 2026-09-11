import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deliverPendingNotifications, pruneOutbox } from '@/lib/push';

/**
 * The scheduled sweep. Three jobs, in order:
 *
 *   1. queue a reminder for anything on the calendar starting soon
 *   2. send whatever is queued — reminders, plus any row an earlier inline
 *      delivery could not send
 *   3. forget rows that were sent a week ago
 *
 * Called every five minutes by pg_cron inside Supabase (scripts/push-cron-
 * setup.mjs), not by Vercel: the Hobby plan allows one cron a day, which is
 * useless for "your meeting starts in an hour". Whoever calls it sends
 * `Authorization: Bearer $CRON_SECRET`; anyone else gets 401. The proxy
 * matcher already excludes /api, so no session is involved.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const admin = createAdminClient();

  // How far ahead a reminder looks. Wider than the sweep interval so a slow
  // or skipped run cannot miss a meeting; the dedupe key stops repeats.
  const minutes = Number(process.env.PUSH_REMINDER_MINUTES ?? '60');

  const { data: reminders, error } = await admin.rpc('push_enqueue_reminders', {
    p_minutes: Number.isFinite(minutes) ? minutes : 60,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const report = await deliverPendingNotifications(200);
  await pruneOutbox();

  return NextResponse.json({ reminders: reminders ?? 0, ...report });
}
